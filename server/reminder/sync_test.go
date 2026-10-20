package reminder

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"smallgo/server/config"
	"smallgo/server/database"
	"smallgo/server/server"
	"smallgo/server/sysconfig"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ---- 测试脚手架 ----

func newSyncDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := database.InitDB(filepath.Join(t.TempDir(), "sync-test.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	// 与生产一致：实例标识与同步令牌在首次启动时自动生成。
	if err := sysconfig.InitDefaultConfigs(db); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.CloseDB(db) })
	return db
}

// insertLegacyRow 模拟「同步功能上线之前就存在的数据」：跳过 BeforeCreate 钩子，
// 让 sync_uid 留空，与老版本写进库里的行保持一致。补标识逻辑只处理这种行。
func insertLegacyRow(t *testing.T, db *gorm.DB, value interface{}) {
	t.Helper()
	if err := db.Session(&gorm.Session{SkipHooks: true}).Create(value).Error; err != nil {
		t.Fatal(err)
	}
}

func seedUser(t *testing.T, db *gorm.DB, username, role string) database.User {
	t.Helper()
	user := database.User{Username: username, Password: "hashed", Role: role, Status: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	return user
}

// configureSync 写一份完整的同步设置，返回规范化后的地址。
func configureSync(t *testing.T, db *gorm.DB, direction, peerURL, token string) {
	t.Helper()
	if err := saveSyncSettings(db, syncSettingsInput{
		Direction: direction, PeerURL: peerURL, Token: token,
	}); err != nil {
		t.Fatalf("保存同步设置失败: %v", err)
	}
}

// fingerprint 把「同步关心的数据形态」压成可比较的字符串集合：
// 标题、到期时间、更新时间、删除状态、所属清单、完成时间。
// 用它比较两台机器同步后是否真的收敛，比逐字段断言更能发现问题。
func fingerprint(t *testing.T, db *gorm.DB) []string {
	t.Helper()
	var lists []List
	if err := db.Find(&lists).Error; err != nil {
		t.Fatal(err)
	}
	listName := map[uint]string{}
	for _, l := range lists {
		listName[l.ID] = l.Name
	}
	out := make([]string, 0, len(lists))
	for _, l := range lists {
		out = append(out, "list|"+l.Name+"|"+boolMark(l.DeletedAt != nil))
	}
	var reminders []Reminder
	if err := db.Find(&reminders).Error; err != nil {
		t.Fatal(err)
	}
	for _, r := range reminders {
		// 指纹里带上时间段（start_at/end_at）：漏了的话「区间没同步过去」会被判成一致。
		out = append(out, "reminder|"+r.Title+"|"+listName[r.ListID]+"|"+stamp(r.DueAt)+"|"+
			stamp(r.StartAt)+"|"+stamp(r.EndAt)+"|"+
			r.UpdatedAt.UTC().Format(time.RFC3339Nano)+"|"+boolMark(r.DeletedAt != nil)+"|"+stamp(r.CompletedAt))
	}
	var completions []Completion
	if err := db.Find(&completions).Error; err != nil {
		t.Fatal(err)
	}
	for _, c := range completions {
		out = append(out, "completion|"+c.TitleSnapshot+"|"+c.CompletedAt.UTC().Format(time.RFC3339Nano))
	}
	sort.Strings(out)
	return out
}

func boolMark(v bool) string {
	if v {
		return "deleted"
	}
	return "live"
}

func stamp(t *time.Time) string {
	if t == nil {
		return "-"
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func assertSameFingerprint(t *testing.T, want, got []string, context string) {
	t.Helper()
	if strings.Join(want, "\n") != strings.Join(got, "\n") {
		t.Fatalf("%s：两台机器的数据未收敛\n--- A ---\n%s\n--- B ---\n%s",
			context, strings.Join(want, "\n"), strings.Join(got, "\n"))
	}
}

func syncTestRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	api := r.Group("/api")
	setupSyncPublicRoutes(api, db)
	setupSyncAdminRoutes(api, db)
	return r
}

// ---- 标识 ----

// TestSyncUIDBackfillIsDeterministicAcrossCopies 证明「先有数据、后开同步」
// 这个场景下，两台内容一致的机器（典型做法是把数据目录整份复制过去）会给同一条
// 数据补出同一个同步标识，首次同步不会把同一批数据复制成两份。
func TestSyncUIDBackfillIsDeterministicAcrossCopies(t *testing.T) {
	created := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	due := time.Date(2026, 3, 2, 9, 0, 0, 0, time.UTC)

	seed := func(t *testing.T, db *gorm.DB) {
		user := seedUser(t, db, "王耀辉", "admin")
		list := List{UserID: user.ID, Name: "工作安排", Color: "violet", Icon: "list",
			CreatedAt: created, UpdatedAt: created}
		insertLegacyRow(t, db, &list)
		item := Reminder{UserID: user.ID, ListID: list.ID, Title: "交季度报表", Kind: KindTask,
			DueAt: &due, RepeatRule: "none", Calendar: "solar", Version: 1,
			CreatedAt: created, UpdatedAt: created}
		insertLegacyRow(t, db, &item)
		history := Completion{ReminderID: item.ID, UserID: user.ID, TitleSnapshot: item.Title,
			ScheduledFor: &due, CompletedAt: due}
		insertLegacyRow(t, db, &history)
		if err := BackfillSyncUIDs(db); err != nil {
			t.Fatal(err)
		}
	}

	dbA, dbB := newSyncDB(t), newSyncDB(t)
	seed(t, dbA)
	seed(t, dbB)

	uids := func(t *testing.T, db *gorm.DB) []string {
		var out []string
		var lists []List
		db.Find(&lists)
		for _, l := range lists {
			out = append(out, l.SyncUID)
		}
		var reminders []Reminder
		db.Find(&reminders)
		for _, r := range reminders {
			out = append(out, r.SyncUID)
		}
		var completions []Completion
		db.Find(&completions)
		for _, c := range completions {
			out = append(out, c.SyncUID)
		}
		sort.Strings(out)
		return out
	}

	gotA, gotB := uids(t, dbA), uids(t, dbB)
	if len(gotA) != 3 {
		t.Fatalf("期望 3 个标识（清单/提醒/完成），得到 %v", gotA)
	}
	for i := range gotA {
		if gotA[i] == "" {
			t.Fatalf("存在未补齐的标识：%v", gotA)
		}
	}
	if strings.Join(gotA, ",") != strings.Join(gotB, ",") {
		t.Fatalf("内容一致的两台机器补出的标识不同：\nA=%v\nB=%v", gotA, gotB)
	}
}

// TestSyncUIDBackfillKeepsExistingTimestamps 确认补标识不会顺手改 updated_at：
// 那会让历史行看起来刚刚被修改，首次同步时整批覆盖对端。
func TestSyncUIDBackfillKeepsExistingTimestamps(t *testing.T) {
	db := newSyncDB(t)
	user := seedUser(t, db, "王耀辉", "admin")
	old := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)
	list := List{UserID: user.ID, Name: "旧清单", Color: "blue", Icon: "list", CreatedAt: old, UpdatedAt: old}
	if err := db.Create(&list).Error; err != nil {
		t.Fatal(err)
	}
	if err := BackfillSyncUIDs(db); err != nil {
		t.Fatal(err)
	}
	var reloaded List
	if err := db.First(&reloaded, list.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !reloaded.UpdatedAt.Equal(old) {
		t.Fatalf("补标识改动了 updated_at：期望 %v，得到 %v", old, reloaded.UpdatedAt)
	}
	if reloaded.SyncUID == "" {
		t.Fatal("补标识没有生效")
	}
}

// ---- 合并 ----

// TestSyncConvergesWithDifferentUserIDs 是最核心的一条：两台机器上同一个人的
// 账号主键不同（各自建号顺序不同），同步必须按用户名配对，而不是按主键。
func TestSyncConvergesWithDifferentUserIDs(t *testing.T) {
	withShanghaiLocal(t)
	dbA, dbB := newSyncDB(t), newSyncDB(t)

	userA := seedUser(t, dbA, "王耀辉", "admin")
	// B 上先有一个别的账号，好让「王耀辉」在两边拿到不同的主键。
	seedUser(t, dbB, "临时账号", "user")
	userB := seedUser(t, dbB, "王耀辉", "admin")
	if userA.ID == userB.ID {
		t.Fatalf("测试前提不成立：两边主键相同（%d）", userA.ID)
	}

	due := time.Now().Add(3 * time.Hour).Truncate(time.Second)
	list, err := ensureDefaultList(dbA, userA.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "季度报表", ListID: list.ID, DueAt: &due, RepeatRule: "none",
		Channels: []string{ChannelInApp, ChannelEmail},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "会议纪要", ListID: list.ID, Kind: KindNote, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	recurring := time.Now().Add(1 * time.Hour).Truncate(time.Second)
	created, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "每月对账", ListID: list.ID, DueAt: &recurring, RepeatRule: "monthly",
		Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminder(dbA, userA.ID, created.ID); err != nil {
		t.Fatal(err)
	}

	snap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	stats, err := applySyncSnapshot(dbB, snap)
	if err != nil {
		t.Fatalf("合并失败: %v", err)
	}
	if stats.RemindersCreated != 3 || stats.CompletionsCreated != 1 {
		t.Fatalf("合并计数不对：%+v", stats)
	}

	// 归属必须落在 B 自己的「王耀辉」上，而不是别的账号。
	var reminders []Reminder
	if err := dbB.Find(&reminders).Error; err != nil {
		t.Fatal(err)
	}
	for _, r := range reminders {
		if r.UserID != userB.ID {
			t.Fatalf("提醒 %q 归到了用户 %d，期望 %d", r.Title, r.UserID, userB.ID)
		}
	}
	var channels []ReminderChannel
	if err := dbB.Where("reminder_id = ?", reminders[0].ID).Find(&channels).Error; err != nil {
		t.Fatal(err)
	}
	assertSameFingerprint(t, fingerprint(t, dbA), fingerprint(t, dbB), "首次同步后")

	// 再同步一次必须是幂等的：没有新增，也没有把数据改脏。
	second, err := applySyncSnapshot(dbB, snap)
	if err != nil {
		t.Fatal(err)
	}
	if second.total() != 0 {
		t.Fatalf("重复合并产生了改动：%+v", second)
	}
	assertSameFingerprint(t, fingerprint(t, dbA), fingerprint(t, dbB), "重复同步后")
}

// TestSyncLastWriteWinsAndDeletePropagates 覆盖冲突裁决与删除传播。
func TestSyncLastWriteWinsAndDeletePropagates(t *testing.T) {
	withShanghaiLocal(t)
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "王耀辉", "admin")
	seedUser(t, dbB, "王耀辉", "admin")
	due := time.Now().Add(2 * time.Hour).Truncate(time.Second)
	list, err := ensureDefaultList(dbA, userA.ID)
	if err != nil {
		t.Fatal(err)
	}
	item, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "初始标题", ListID: list.ID, DueAt: &due, RepeatRule: "none",
		Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	snap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, snap); err != nil {
		t.Fatal(err)
	}

	// A 改标题但时间更早，B 改标题且时间更晚：晚的一方必须赢。
	older := time.Now().Add(-2 * time.Minute)
	newer := time.Now().Add(-1 * time.Minute)
	if err := dbA.Model(&Reminder{}).Where("id = ?", item.ID).
		Updates(map[string]interface{}{"title": "A 的旧改动", "updated_at": older}).Error; err != nil {
		t.Fatal(err)
	}
	var localB Reminder
	if err := dbB.Where("sync_uid = ?", item.SyncUID).First(&localB).Error; err != nil {
		t.Fatal(err)
	}
	if err := dbB.Model(&Reminder{}).Where("id = ?", localB.ID).
		Updates(map[string]interface{}{"title": "B 的新改动", "updated_at": newer}).Error; err != nil {
		t.Fatal(err)
	}

	localSnapA, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, localSnapA); err != nil {
		t.Fatal(err)
	}
	if err := dbB.Where("sync_uid = ?", item.SyncUID).First(&localB).Error; err != nil {
		t.Fatal(err)
	}
	if localB.Title != "B 的新改动" {
		t.Fatalf("时间较旧的改动覆盖了较新的：标题 = %q", localB.Title)
	}

	// 反向：B 把较新的改动推给 A，A 必须接受。
	snapB, err := buildSyncSnapshot(dbB)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbA, snapB); err != nil {
		t.Fatal(err)
	}
	assertSameFingerprint(t, fingerprint(t, dbA), fingerprint(t, dbB), "冲突裁决后")

	// A 删除该提醒（软删除即墓碑），必须传播到 B，且 B 上排队的投递任务被取消。
	if err := deleteReminder(dbA, userA.ID, item.ID); err != nil {
		t.Fatal(err)
	}
	deleted, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	stats, err := applySyncSnapshot(dbB, deleted)
	if err != nil {
		t.Fatal(err)
	}
	if stats.RemindersDeleted != 1 {
		t.Fatalf("删除没有传播：%+v", stats)
	}
	var afterDelete Reminder
	if err := dbB.Where("sync_uid = ?", item.SyncUID).First(&afterDelete).Error; err != nil {
		t.Fatal(err)
	}
	if afterDelete.DeletedAt == nil {
		t.Fatal("对端的删除没有落到本机")
	}
	var pending int64
	if err := dbB.Model(&DeliveryJob{}).
		Where("reminder_id = ? AND status IN ?", afterDelete.ID, []string{"pending", "retry"}).
		Count(&pending).Error; err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Fatalf("删除后仍留着 %d 条待投递任务", pending)
	}
	assertSameFingerprint(t, fingerprint(t, dbA), fingerprint(t, dbB), "删除传播后")
}

// TestSyncSkipsUnmappedUsers 证明对端有、本机没有的账号会被跳过并上报，
// 而不是被塞进某个不该拥有它的账号里。
func TestSyncSkipsUnmappedUsers(t *testing.T) {
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "只有A有的账号", "admin")
	seedUser(t, dbB, "另一台机器的账号", "admin")
	due := time.Now().Add(time.Hour).Truncate(time.Second)
	if _, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "不该出现的任务", DueAt: &due, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	snap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	stats, err := applySyncSnapshot(dbB, snap)
	if err != nil {
		t.Fatal(err)
	}
	if stats.total() != 0 || stats.Skipped == 0 {
		t.Fatalf("未匹配账号的数据没有被跳过：%+v", stats)
	}
	found := false
	for _, name := range stats.UnmappedUsers {
		if name == "只有A有的账号" {
			found = true
		}
	}
	if !found {
		t.Fatalf("没有上报未匹配账号：%+v", stats.UnmappedUsers)
	}
	var count int64
	dbB.Model(&Reminder{}).Count(&count)
	if count != 0 {
		t.Fatalf("本机凭空多出 %d 条数据", count)
	}
}

// TestSyncRejectsSelfAndWrongFormat 挡住两类会毁数据的配置错误：
// 对端地址填成了自己（会把本机数据当成对端数据合并），以及报文版本不一致。
func TestSyncRejectsSelfAndWrongFormat(t *testing.T) {
	db := newSyncDB(t)
	seedUser(t, db, "王耀辉", "admin")
	settings, err := loadSyncSettings(db)
	if err != nil {
		t.Fatal(err)
	}
	self := syncSnapshot{Format: syncFormat, InstanceID: settings.InstanceID}
	if _, err := applySyncSnapshot(db, self); err == nil {
		t.Fatal("对端指向本机时应当被拒绝")
	}
	other := syncSnapshot{Format: syncFormat + 1, InstanceID: "abcd1234"}
	if _, err := applySyncSnapshot(db, other); err == nil {
		t.Fatal("报文版本不兼容时应当被拒绝")
	}
}

// TestSyncRepointsOrphanRemindersWhenPeerDeletesList 覆盖一个容易漏掉的边角：
// 本机在某个清单里新建了一条还没同步出去的提醒，对端把整个清单删了。
// 这条提醒不能被留在已删除的清单上（那样它会从界面上直接消失），
// 而应被收拢到默认清单。
func TestSyncRepointsOrphanRemindersWhenPeerDeletesList(t *testing.T) {
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "王耀辉", "admin")
	userB := seedUser(t, dbB, "王耀辉", "admin")
	due := time.Now().Add(5 * time.Hour).Truncate(time.Second)
	extra := List{UserID: userA.ID, Name: "项目B", Color: "amber", Icon: "list"}
	if err := dbA.Create(&extra).Error; err != nil {
		t.Fatal(err)
	}
	snap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, snap); err != nil {
		t.Fatal(err)
	}

	// B 在这个清单里新建一条提醒，还没同步给 A。
	var listB List
	if err := dbB.Where("sync_uid = ?", extra.SyncUID).First(&listB).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := createReminder(dbB, userB.ID, SaveReminderInput{
		Title: "B 自己新加的任务", ListID: listB.ID, DueAt: &due, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}

	// A 删除整个清单。
	if err := deleteList(dbA, userA.ID, extra.ID); err != nil {
		t.Fatal(err)
	}
	deletedSnap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, deletedSnap); err != nil {
		t.Fatal(err)
	}

	var orphan Reminder
	if err := dbB.Where("title = ?", "B 自己新加的任务").First(&orphan).Error; err != nil {
		t.Fatal(err)
	}
	var host List
	if err := dbB.First(&host, orphan.ListID).Error; err != nil {
		t.Fatal(err)
	}
	if host.DeletedAt != nil {
		t.Fatalf("本机新建的提醒被留在已删除的清单 %q 上", host.Name)
	}
}

// TestSyncMovesRemindersWhenListDeleted 证明清单的删除会连带把本机该清单下的
// 提醒挪到默认清单，而不是留下一批挂在已删除清单上的孤儿。
func TestSyncMovesRemindersWhenListDeleted(t *testing.T) {
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "王耀辉", "admin")
	seedUser(t, dbB, "王耀辉", "admin")
	due := time.Now().Add(4 * time.Hour).Truncate(time.Second)
	extra := List{UserID: userA.ID, Name: "项目A", Color: "rose", Icon: "list"}
	if err := dbA.Create(&extra).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "项目任务", ListID: extra.ID, DueAt: &due, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	snap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, snap); err != nil {
		t.Fatal(err)
	}

	if err := deleteList(dbA, userA.ID, extra.ID); err != nil {
		t.Fatalf("删除清单失败: %v", err)
	}
	deletedSnap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, deletedSnap); err != nil {
		t.Fatal(err)
	}
	var listB List
	if err := dbB.Where("sync_uid = ?", extra.SyncUID).First(&listB).Error; err != nil {
		t.Fatal(err)
	}
	if listB.DeletedAt == nil {
		t.Fatal("清单的删除没有传播")
	}
	var moved Reminder
	if err := dbB.Where("title = ?", "项目任务").First(&moved).Error; err != nil {
		t.Fatal(err)
	}
	if moved.ListID == listB.ID {
		t.Fatal("提醒仍挂在已删除的清单上")
	}
	var fallback List
	if err := dbB.First(&fallback, moved.ListID).Error; err != nil {
		t.Fatal(err)
	}
	if fallback.DeletedAt != nil {
		t.Fatal("提醒被挪到了一个已删除的清单上")
	}
	assertSameFingerprint(t, fingerprint(t, dbA), fingerprint(t, dbB), "清单删除后")
}

// TestSyncSnapshotCarriesNoSecrets 是一条防泄漏断言：账号密码、渠道凭据、
// 管理员维护的 provider 密钥都不该出现在同步报文里。
func TestSyncSnapshotCarriesNoSecrets(t *testing.T) {
	db := newSyncDB(t)
	user := seedUser(t, db, "王耀辉", "admin")
	if err := db.Create(&ProviderConfig{Provider: "feishu", Secret: "super-secret-token"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&ChannelBinding{UserID: user.ID, Channel: ChannelSMS,
		Target: "+8613800000000", TargetMasked: "138****0000", Status: "active"}).Error; err != nil {
		t.Fatal(err)
	}
	snap, err := buildSyncSnapshot(db)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, secret := range []string{"super-secret-token", "+8613800000000", "hashed"} {
		if strings.Contains(text, secret) {
			t.Fatalf("同步报文里出现了不该同步的内容：%q", secret)
		}
	}
}

// ---- 接口与端到端 ----

func TestSyncPeerEndpointsRequireTokenAndEnabledDirection(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := newSyncDB(t)
	seedUser(t, db, "王耀辉", "admin")
	router := syncTestRouter(db)

	call := func(token string) int {
		req := httptest.NewRequest(http.MethodGet, "/api/reminder/sync/info", nil)
		if token != "" {
			req.Header.Set(syncTokenHeader, token)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}

	// 未启用同步：即使令牌正确也不接受对端数据。
	if code := call(""); code != http.StatusForbidden {
		t.Fatalf("未启用同步时应当 403，得到 %d", code)
	}
	configureSync(t, db, syncDirectionBoth, "http://127.0.0.1:1", "shared-token-123")
	if code := call(""); code != http.StatusUnauthorized {
		t.Fatalf("缺少令牌时应当 401，得到 %d", code)
	}
	if code := call("wrong-token-123"); code != http.StatusUnauthorized {
		t.Fatalf("令牌错误时应当 401，得到 %d", code)
	}
	if code := call("shared-token-123"); code != http.StatusOK {
		t.Fatalf("令牌正确时应当 200，得到 %d", code)
	}
}

// TestSyncRoutesAreWiredIntoServerRouter 用真正的路由器跑一遍：确认路由挂在
// /api/reminder/sync/* 下（漏挂时这条会失败），也顺带验证公开组与受保护组的
// 路由没有冲突（gin 遇到冲突会 panic）。
func TestSyncRoutesAreWiredIntoServerRouter(t *testing.T) {
	db := newSyncDB(t)
	seedUser(t, db, "王耀辉", "admin")
	configureSync(t, db, syncDirectionBoth, "http://127.0.0.1:1", "shared-token-123")
	settings, err := loadSyncSettings(db)
	if err != nil {
		t.Fatal(err)
	}

	router := server.NewRouter(config.Config{}, db, "test-jwt-secret")
	req := httptest.NewRequest(http.MethodGet, "/api/reminder/sync/info", nil)
	req.Header.Set(syncTokenHeader, "shared-token-123")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/reminder/sync/info 应当 200，得到 %d：%s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Code int          `json:"code"`
		Data syncPeerInfo `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Data.InstanceID != settings.InstanceID {
		t.Fatalf("对端信息里的实例标识不对：%q != %q", envelope.Data.InstanceID, settings.InstanceID)
	}
}

// TestSyncEndToEndPushPullAndConverge 用两个真实的 HTTP 服务把三种方向都走一遍。
func TestSyncEndToEndPushPullAndConverge(t *testing.T) {
	withShanghaiLocal(t)
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "王耀辉", "admin")
	userB := seedUser(t, dbB, "王耀辉", "admin")

	serverA := httptest.NewServer(syncTestRouter(dbA))
	defer serverA.Close()
	serverB := httptest.NewServer(syncTestRouter(dbB))
	defer serverB.Close()

	// 单向推送：A 的数据全部到 B。
	configureSync(t, dbA, syncDirectionPush, serverB.URL, "shared-token-123")
	configureSync(t, dbB, syncDirectionPull, serverA.URL, "shared-token-123")
	due := time.Now().Add(2 * time.Hour).Truncate(time.Second)
	if _, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "A 建的任务", DueAt: &due, RepeatRule: "none", Channels: []string{ChannelInApp},
	}); err != nil {
		t.Fatal(err)
	}
	result, err := runSync(dbA, "manual")
	if err != nil {
		t.Fatalf("单向推送失败: %v", err)
	}
	if result.Status != "ok" || result.Pushed == nil || result.Pushed.RemindersCreated != 1 {
		t.Fatalf("单向推送结果不对：%+v", result)
	}
	var countB int64
	dbB.Model(&Reminder{}).Count(&countB)
	if countB != 1 {
		t.Fatalf("对端收到 %d 条提醒，期望 1", countB)
	}

	// 单向拉取：B 拉 A 的改动。
	if err := deleteReminder(dbA, userA.ID, itemIDByTitle(t, dbA, "A 建的任务")); err != nil {
		t.Fatal(err)
	}
	pullResult, err := runSync(dbB, "manual")
	if err != nil {
		t.Fatalf("单向拉取失败: %v", err)
	}
	if pullResult.Pulled == nil || pullResult.Pulled.RemindersDeleted != 1 {
		t.Fatalf("单向拉取没有拿到删除：%+v", pullResult)
	}

	// 双向：各自新建一条，跑一次同步后两台机器都必须有两条。
	configureSync(t, dbA, syncDirectionBoth, serverB.URL, "shared-token-123")
	configureSync(t, dbB, syncDirectionBoth, serverA.URL, "shared-token-123")
	if _, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "A 的新任务", DueAt: &due, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := createReminder(dbB, userB.ID, SaveReminderInput{
		Title: "B 的新任务", DueAt: &due, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := runSync(dbA, "manual"); err != nil {
		t.Fatalf("双向同步（A 发起）失败: %v", err)
	}
	assertSameFingerprint(t, fingerprint(t, dbA), fingerprint(t, dbB), "双向同步后")

	titlesA := reminderTitles(t, dbA)
	want := []string{"A 的新任务", "B 的新任务"}
	if strings.Join(titlesA, ",") != strings.Join(want, ",") {
		t.Fatalf("双向同步后 A 的提醒 = %v，期望 %v", titlesA, want)
	}

	// 再跑一次（B 发起）必须是幂等的：两边都不再变化。
	before := fingerprint(t, dbA)
	if _, err := runSync(dbB, "manual"); err != nil {
		t.Fatalf("双向同步（B 发起）失败: %v", err)
	}
	assertSameFingerprint(t, before, fingerprint(t, dbA), "B 发起重复同步后 A 不变")
	assertSameFingerprint(t, fingerprint(t, dbA), fingerprint(t, dbB), "B 发起重复同步后收敛")
}

func itemIDByTitle(t *testing.T, db *gorm.DB, title string) uint {
	t.Helper()
	var item Reminder
	if err := db.Where("title = ?", title).First(&item).Error; err != nil {
		t.Fatal(err)
	}
	return item.ID
}

func reminderTitles(t *testing.T, db *gorm.DB) []string {
	t.Helper()
	var items []Reminder
	if err := db.Where("deleted_at IS NULL").Find(&items).Error; err != nil {
		t.Fatal(err)
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, item.Title)
	}
	sort.Strings(out)
	return out
}

// ---- 设置 ----

func TestSyncSettingsValidation(t *testing.T) {
	db := newSyncDB(t)
	cases := []struct {
		name string
		in   syncSettingsInput
		want string
	}{
		{"方向非法", syncSettingsInput{Direction: "sideways", PeerURL: "http://a.b", Token: "12345678"}, "方向"},
		{"启用但没填地址", syncSettingsInput{Direction: syncDirectionPush, Token: "12345678"}, "对端地址"},
		{"令牌太短", syncSettingsInput{Direction: syncDirectionPush, PeerURL: "http://a.b", Token: "short"}, "令牌"},
		{"间隔为负", syncSettingsInput{Direction: syncDirectionOff, IntervalMinutes: -1}, "间隔"},
		{"间隔过密", syncSettingsInput{Direction: syncDirectionOff, IntervalMinutes: 1}, "5 分钟"},
	}
	for _, tc := range cases {
		err := saveSyncSettings(db, tc.in)
		if err == nil {
			t.Fatalf("%s：期望报错但通过了", tc.name)
		}
		if !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s：错误信息应包含 %q，得到 %q", tc.name, tc.want, err.Error())
		}
	}

	// 地址补协议、去尾斜杠；关掉同步时不要求令牌。
	if err := saveSyncSettings(db, syncSettingsInput{
		Direction: syncDirectionOff, PeerURL: "192.168.1.10:8906/",
	}); err != nil {
		t.Fatal(err)
	}
	settings, err := loadSyncSettings(db)
	if err != nil {
		t.Fatal(err)
	}
	if settings.PeerURL != "http://192.168.1.10:8906" {
		t.Fatalf("地址规范化结果 = %q", settings.PeerURL)
	}
	// 令牌留空表示「不改」，此时不该把已有令牌清掉。
	if settings.Token == "" {
		t.Fatal("保存设置时把同步令牌清空了")
	}
}

// TestAutoSyncTickRespectsDirectionAndInterval 覆盖定时同步的三道闸门：
// 方向为关闭时不动、距上次同步不够久时不动、到点了才真的同步。
// 「上次同步时间为空」必须允许立刻同步一次，否则刚打开同步的用户要等到
// 第一个间隔周期结束（最长一天）才会看到数据，像是没生效。
func TestAutoSyncTickRespectsDirectionAndInterval(t *testing.T) {
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "王耀辉", "admin")
	seedUser(t, dbB, "王耀辉", "admin")
	serverB := httptest.NewServer(syncTestRouter(dbB))
	defer serverB.Close()
	// B 必须自己启用同步才会接收对端推来的数据（方向无所谓，这里用拉取）。
	configureSync(t, dbB, syncDirectionPull, "http://127.0.0.1:1", "shared-token-123")

	due := time.Now().Add(2 * time.Hour).Truncate(time.Second)
	if _, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "待同步的任务", DueAt: &due, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}

	countB := func() int64 {
		var total int64
		dbB.Model(&Reminder{}).Count(&total)
		return total
	}

	// 方向为关闭：心跳什么都不做。
	configureSync(t, dbA, syncDirectionOff, serverB.URL, "shared-token-123")
	autoSyncTick(dbA)
	if got := countB(); got != 0 {
		t.Fatalf("方向为关闭时仍然同步了：对端有 %d 条", got)
	}

	// 启用 + 有间隔：第一次心跳（上次同步时间为空）立刻同步一次。
	if err := saveSyncSettings(dbA, syncSettingsInput{
		Direction: syncDirectionPush, PeerURL: serverB.URL, Token: "shared-token-123",
		IntervalMinutes: 30,
	}); err != nil {
		t.Fatal(err)
	}
	autoSyncTick(dbA)
	if got := countB(); got != 1 {
		t.Fatalf("首次心跳没有同步：对端有 %d 条，期望 1", got)
	}

	// 刚同步过：同一个间隔内不再重复同步。给对端造一条本地数据，
	// 如果又同步了一次，这条数据会被推过去。
	if _, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "间隔内不该被推送", DueAt: &due, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	autoSyncTick(dbA)
	if got := countB(); got != 1 {
		t.Fatalf("间隔未到却同步了：对端有 %d 条，期望 1", got)
	}

	// 上次同步时间往前拨 31 分钟：下次心跳应当真的同步。
	lastBefore, err := time.Parse(time.RFC3339, syncConfigValue(dbA, "sync_last_at"))
	if err != nil {
		t.Fatal(err)
	}
	if err := sysconfig.UpdateConfig(dbA, "sync_last_at",
		lastBefore.Add(-31*time.Minute).Format(time.RFC3339), 0); err != nil {
		t.Fatal(err)
	}
	autoSyncTick(dbA)
	if got := countB(); got != 2 {
		t.Fatalf("到点后没有同步：对端有 %d 条，期望 2", got)
	}
}

// TestSaveSyncSettingsKeepsExistingToken 锁住「令牌留空 = 不改」这条约定：
// 启用状态下只改对端地址（不带令牌）必须成功，并且库里的令牌原样保留。
// 之前只在入参上做校验，这种调用会被判成「令牌至少 8 位」而 400（实测踩到）。
func TestSaveSyncSettingsKeepsExistingToken(t *testing.T) {
	db := newSyncDB(t)
	if err := saveSyncSettings(db, syncSettingsInput{
		Direction: syncDirectionBoth, PeerURL: "http://192.168.1.10:8908", Token: "shared-token-123",
	}); err != nil {
		t.Fatal(err)
	}
	before, err := loadSyncSettings(db)
	if err != nil {
		t.Fatal(err)
	}

	// 只改地址、令牌留空
	if err := saveSyncSettings(db, syncSettingsInput{
		Direction: syncDirectionBoth, PeerURL: "http://192.168.1.10:8906",
	}); err != nil {
		t.Fatalf("令牌留空表示不改，应当成功，实际报错：%v", err)
	}
	after, err := loadSyncSettings(db)
	if err != nil {
		t.Fatal(err)
	}
	if after.Token != before.Token {
		t.Fatalf("令牌不该被改动：%q → %q", before.Token, after.Token)
	}
	if after.PeerURL != "http://192.168.1.10:8906" {
		t.Fatalf("地址应已更新，实际 %q", after.PeerURL)
	}

	// 库里令牌被清空时必须拦住：否则会启用一个「空令牌」的同步。
	if err := sysconfig.UpdateConfig(db, "sync_token", "", 0); err != nil {
		t.Fatal(err)
	}
	if err := saveSyncSettings(db, syncSettingsInput{
		Direction: syncDirectionBoth, PeerURL: "http://192.168.1.10:8906",
	}); err == nil {
		t.Fatal("库里令牌为空时应当拒绝启用同步")
	}

	// 新填一个太短的令牌仍然要拦。
	if err := saveSyncSettings(db, syncSettingsInput{
		Direction: syncDirectionBoth, PeerURL: "http://192.168.1.10:8906", Token: "short",
	}); err == nil {
		t.Fatal("太短的令牌应当被拒绝")
	}
}
