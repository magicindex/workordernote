package reminder

import (
	"path/filepath"
	"testing"
	"time"

	"gorm.io/gorm"

	"smallgo/server/database"
)

// 完成记录的「撤回」必须能跨机生效：
//
//	A 上标记已还（写一条完成历史）→ 同步到 B → A 撤销已还（软删）→ 再同步，B 那条也要撤回。
//
// 这条曾经是硬删除，硬删在快照里没有任何痕迹，于是 B 会永远留着一条幽灵记录
// （0.13.0 发版时记录的已知限制）。用例就是钉住「墓碑要跟着同步走」。
func TestCompletionRetractionSyncsToPeer(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	const username = "同步撤回用户"
	owner := seedUser(t, appDB, username, "admin")
	configureSync(t, appDB, syncDirectionBoth, "http://192.168.1.90:8906", "shared-token-123")

	// B 端另起一个库（同一个账号）
	dbB, err := database.InitDB(filepath.Join(t.TempDir(), "peer-retract.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(dbB); err != nil {
		t.Fatal(err)
	}
	defer database.CloseDB(dbB)
	seedUser(t, dbB, username, "admin")
	configureSync(t, dbB, syncDirectionBoth, "http://192.168.1.91:8906", "shared-token-123")

	// A：一条每天重复的提醒，先完成一次 → 完成历史里多一条
	due := time.Now().Add(-time.Hour)
	item, err := createReminder(appDB, owner.ID, SaveReminderInput{
		Title: "撤回测试", DueAt: &due, RepeatRule: "daily", Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminder(appDB, owner.ID, item.ID); err != nil {
		t.Fatal(err)
	}

	snap1, err := buildSyncSnapshot(appDB)
	if err != nil {
		t.Fatal(err)
	}
	first := findSnapCompletion(snap1, "撤回测试")
	if first == nil {
		t.Fatal("快照里应该有这条完成记录")
	}
	if first.Deleted {
		t.Fatal("刚完成的记录不该带删除标记")
	}

	snap1.InstanceID = "peer-a-instance"
	if _, err := applySyncSnapshot(dbB, snap1); err != nil {
		t.Fatal(err)
	}
	if got := countCompletions(dbB, "撤回测试", false); got != 1 {
		t.Fatalf("对端应收到这条完成记录，实际 %d", got)
	}

	// A 撤回（撤销已还走的就是这一步：软删）
	if err := appDB.Where("title_snapshot = ?", "撤回测试").Delete(&Completion{}).Error; err != nil {
		t.Fatal(err)
	}
	snap2, err := buildSyncSnapshot(appDB)
	if err != nil {
		t.Fatal(err)
	}
	tomb := findSnapCompletion(snap2, "撤回测试")
	if tomb == nil || !tomb.Deleted {
		t.Fatalf("撤回后快照里应带着墓碑（Deleted=true）：%+v", tomb)
	}
	snap2.InstanceID = "peer-a-instance"
	stats, err := applySyncSnapshot(dbB, snap2)
	if err != nil {
		t.Fatal(err)
	}
	if stats.CompletionsDeleted != 1 {
		t.Fatalf("对端应撤回 1 条，实际 %d（%+v）", stats.CompletionsDeleted, stats)
	}
	if got := countCompletions(dbB, "撤回测试", false); got != 0 {
		t.Fatalf("撤回后对端不该再看到这条完成记录，实际 %d", got)
	}
	if got := countCompletions(dbB, "撤回测试", true); got != 1 {
		t.Fatalf("行应该还在（软删，留作墓碑），实际 %d", got)
	}

	// 幂等：再同步一次不应重复计数、也不该报错
	again, err := applySyncSnapshot(dbB, snap2)
	if err != nil {
		t.Fatal(err)
	}
	if again.CompletionsDeleted != 0 {
		t.Fatalf("重复应用墓碑不应再计数，实际 %d", again.CompletionsDeleted)
	}

	// 撤回后本机也看不到它（列表口径）
	rng := CompletedRange{}
	rows, err := listCompletedHistory(appDB, owner.ID, rng, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.Title == "撤回测试" {
			t.Fatalf("撤回的完成记录不该出现在「已完成」里：%+v", r)
		}
	}
}

// 「已完成」角标读的是裸 SQL 子查询，必须自己带上 deleted_at 过滤——漏了的话
// 撤回过的记录还会被算进去（角标和列表对不上）。
func TestSummaryIgnoresRetractedCompletions(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	const userID = 78
	due := time.Now().Add(-time.Hour)
	item, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "角标撤回", DueAt: &due, RepeatRule: "daily", Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminder(appDB, userID, item.ID); err != nil {
		t.Fatal(err)
	}
	if got := summaryCompleted(t, userID); got != 1 {
		t.Fatalf("完成一次后角标应为 1，实际 %d", got)
	}
	if err := appDB.Where("title_snapshot = ?", "角标撤回").Delete(&Completion{}).Error; err != nil {
		t.Fatal(err)
	}
	if got := summaryCompleted(t, userID); got != 0 {
		t.Fatalf("撤回后角标应回到 0（裸 SQL 也要带 deleted_at 过滤），实际 %d", got)
	}
}

// 本机从来没有过的墓碑：跳过即可，不要凭空建出一条「已删除」的记录。
func TestUnknownCompletionTombstoneIsSkipped(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	seedUser(t, appDB, "墓碑用户", "admin")
	configureSync(t, appDB, syncDirectionPull, "http://192.168.1.92:8906", "shared-token-123")

	past := time.Now().Add(-2 * time.Hour)
	snap := syncSnapshot{
		Format: syncFormat, InstanceID: "peer-tombstone",
		Users: []syncUser{{Username: "墓碑用户2", Role: "admin"}},
		Completions: []syncCompletion{{
			UID: "tomb-uid-1", Owner: "墓碑用户2", TitleSnapshot: "从没见过的记录",
			CompletedAt: past, Deleted: true,
		}},
	}
	stats, err := applySyncSnapshot(appDB, snap)
	if err != nil {
		t.Fatal(err)
	}
	if stats.CompletionsCreated != 0 {
		t.Fatalf("墓碑不该建出新行，实际创建 %d", stats.CompletionsCreated)
	}
	if got := countCompletions(appDB, "从没见过的记录", true); got != 0 {
		t.Fatalf("本机不该出现这条记录（含软删），实际 %d", got)
	}
}

func findSnapCompletion(snap syncSnapshot, title string) *syncCompletion {
	for i := range snap.Completions {
		if snap.Completions[i].TitleSnapshot == title {
			return &snap.Completions[i]
		}
	}
	return nil
}

// countCompletions 数某个标题的完成记录；withDeleted=true 时连软删的一起数。
func countCompletions(db *gorm.DB, title string, withDeleted bool) int64 {
	q := db.Model(&Completion{}).Where("title_snapshot = ?", title)
	if withDeleted {
		q = db.Unscoped().Model(&Completion{}).Where("title_snapshot = ?", title)
	}
	var n int64
	if err := q.Count(&n).Error; err != nil {
		return -1
	}
	return n
}

// 卡片与账单期的**删除墓碑**要能落地：本机内容与对端墓碑完全一样时，
// 也必须按「删除」处理——sameCard 少了删除标记比较就会把它当成「一致，跳过」。
func TestCardTombstoneAppliesWhenContentUnchanged(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	const username = "墓碑卡用户"
	owner := seedUser(t, appDB, username, "admin")
	configureSync(t, appDB, syncDirectionBoth, "http://192.168.1.93:8906", "shared-token-123")

	dbB, err := database.InitDB(filepath.Join(t.TempDir(), "peer-card-tomb.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(dbB); err != nil {
		t.Fatal(err)
	}
	defer database.CloseDB(dbB)
	seedUser(t, dbB, username, "admin")
	configureSync(t, dbB, syncDirectionBoth, "http://192.168.1.94:8906", "shared-token-123")

	// A：建卡 + 记一期金额
	bucket, err := ensureCardBucket(appDB, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	card := Card{
		UserID: owner.ID, ListID: bucket.ID, Name: "墓碑卡", Bank: "招商银行",
		StatementDay: 5, DueDay: 25, AdvanceDays: 3, AutoRepeat: true,
	}
	if err := appDB.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := generateCardPlan(appDB, &card, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := upsertStatement(appDB, owner.ID, card, "2026-10", 12345, 0, ""); err != nil {
		t.Fatal(err)
	}

	snap1, err := buildSyncSnapshot(appDB)
	if err != nil {
		t.Fatal(err)
	}
	snap1.InstanceID = "peer-card-a"
	if _, err := applySyncSnapshot(dbB, snap1); err != nil {
		t.Fatal(err)
	}
	if got := countCards(dbB, "墓碑卡", false); got != 1 {
		t.Fatalf("对端应先有这张卡，实际 %d", got)
	}

	// A：删卡（连带软删它的提醒）与那一期账单
	now := time.Now()
	if err := appDB.Model(&Reminder{}).Where("card_id = ?", card.ID).
		Updates(map[string]interface{}{"deleted_at": now, "updated_at": now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := appDB.Model(&Card{}).Where("id = ?", card.ID).
		Updates(map[string]interface{}{"deleted_at": now, "updated_at": now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := appDB.Model(&CardStatement{}).Where("card_id = ?", card.ID).
		Updates(map[string]interface{}{"deleted_at": now, "updated_at": now}).Error; err != nil {
		t.Fatal(err)
	}

	snap2, err := buildSyncSnapshot(appDB)
	if err != nil {
		t.Fatal(err)
	}
	snap2.InstanceID = "peer-card-a"
	stats, err := applySyncSnapshot(dbB, snap2)
	if err != nil {
		t.Fatal(err)
	}
	if stats.CardsDeleted != 1 {
		t.Fatalf("对端应删除 1 张卡，实际 %d（%+v）", stats.CardsDeleted, stats)
	}
	if got := countCards(dbB, "墓碑卡", false); got != 0 {
		t.Fatalf("删除后对端不该再有这张卡，实际 %d", got)
	}
	if got := countCards(dbB, "墓碑卡", true); got != 1 {
		t.Fatalf("行应保留（软删当墓碑），实际 %d", got)
	}
	var stmts int64
	// 注意：Card/CardStatement 的 DeletedAt 是 *time.Time（不是 gorm.DeletedAt），
	// GORM 不会自动加过滤，这里必须自己写 deleted_at IS NULL。
	if err := dbB.Model(&CardStatement{}).
		Where("card_id = ? AND deleted_at IS NULL", card.ID).Count(&stmts).Error; err != nil {
		t.Fatal(err)
	}
	if stmts != 0 {
		t.Fatalf("账单期也应跟着删掉，实际还剩 %d 行", stmts)
	}
}

func countCards(db *gorm.DB, name string, withDeleted bool) int64 {
	// Card.DeletedAt 是 *time.Time，GORM 不会自动过滤，未删的那种要显式带上条件。
	q := db.Model(&Card{}).Where("name = ? AND deleted_at IS NULL", name)
	if withDeleted {
		q = db.Unscoped().Model(&Card{}).Where("name = ?", name)
	}
	var n int64
	if err := q.Count(&n).Error; err != nil {
		return -1
	}
	return n
}
