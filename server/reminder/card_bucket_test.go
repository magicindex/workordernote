package reminder

import (
	"testing"
	"time"

	"smallgo/server/sysconfig"
)

// 把 feature 缓存关掉：测试里会反复改这个开关，不能让 2 秒缓存影响断言。
func withFreshCardFeature(t *testing.T) {
	t.Helper()
	old := cardFeatureCache
	cardFeatureCache = 0
	resetCardFeatureCache()
	t.Cleanup(func() {
		cardFeatureCache = old
		resetCardFeatureCache()
	})
}

func setCardFeature(t *testing.T, on bool) {
	t.Helper()
	value := "true"
	if !on {
		value = "false"
	}
	if err := sysconfig.UpdateConfig(appDB, "credit_card_enabled", value, 0); err != nil {
		t.Fatal(err)
	}
	resetCardFeatureCache()
}

// 「信用卡账单」是一个固定栏目：自动建一次、重复调用不会建第二条。
func TestCardBucketCreatedOnce(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	first, err := ensureCardBucket(appDB, 31)
	if err != nil {
		t.Fatal(err)
	}
	if first.Name != cardBucketListName || first.Template != listTemplateCard {
		t.Fatalf("卡包清单不对：%+v", first)
	}
	second, err := ensureCardBucket(appDB, 31)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("重复调用不应新建第二条：%d vs %d", first.ID, second.ID)
	}
	var count int64
	if err := appDB.Model(&List{}).Where("user_id = ? AND template = ?", 31, listTemplateCard).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("信用卡清单应只有一条，实际 %d", count)
	}

	// 用户自己把这条清单删掉后，再建卡片应该把它找回来，而不是又建一条同名的。
	now := time.Now()
	if err := appDB.Model(&List{}).Where("id = ?", first.ID).Update("deleted_at", now).Error; err != nil {
		t.Fatal(err)
	}
	again, err := ensureCardBucket(appDB, 31)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != first.ID {
		t.Fatalf("应找回被删掉的卡包清单：%d vs %d", again.ID, first.ID)
	}
	var visible int64
	if err := appDB.Model(&List{}).Where("user_id = ? AND deleted_at IS NULL", 31).Count(&visible).Error; err != nil {
		t.Fatal(err)
	}
	if visible != 1 {
		t.Fatalf("找回后应只有一条可见清单，实际 %d", visible)
	}
}

// 卡片一律归到卡包：接口层不再要 list_id（传了也忽略）。
func TestNewCardAlwaysLandsInBucket(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	bucket, err := ensureCardBucket(appDB, 32)
	if err != nil {
		t.Fatal(err)
	}
	card := Card{
		UserID: 32, ListID: bucket.ID, Name: "白金", Bank: "广发银行",
		StatementDay: 5, DueDay: 25, AdvanceDays: 3, AutoRepeat: true,
	}
	if err := appDB.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := generateCardPlan(appDB, &card, time.Now()); err != nil {
		t.Fatal(err)
	}
	cards, err := listCards(appDB, 32, 0, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) != 1 || cards[0].ListID != bucket.ID {
		t.Fatalf("卡片应挂在信用卡账单栏目下：%+v", cards)
	}
	// 卡片自己占一个清单，普通清单页不该混进卡片提醒——栏目页只显示卡片。
	var remindersInBucket int64
	if err := appDB.Model(&Reminder{}).
		Where("user_id = ? AND list_id = ? AND deleted_at IS NULL", 32, bucket.ID).
		Count(&remindersInBucket).Error; err != nil {
		t.Fatal(err)
	}
	if remindersInBucket != 3 {
		t.Fatalf("应该在卡包清单里生成 3 条提醒，实际 %d", remindersInBucket)
	}
}

// 后台关掉栏目：卡片与提醒从清单/日历/统计里消失，但一条数据都不删；重新打开就回来。
func TestDisableCreditCardHidesButKeepsData(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	const userID = 33
	loc := cardTestLoc(t)
	now := time.Date(2026, time.October, 7, 10, 0, 0, 0, loc)
	bucket, err := ensureCardBucket(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	card := Card{
		UserID: userID, ListID: bucket.ID, Name: "经典白", Bank: "招商银行",
		StatementDay: 5, DueDay: 25, AdvanceDays: 3, AutoRepeat: true,
	}
	if err := appDB.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := generateCardPlan(appDB, &card, now); err != nil {
		t.Fatal(err)
	}
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "普通任务", DueAt: &now, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}

	// 开着的时候：4 条（3 条卡片提醒 + 1 条普通任务），日历里也应该有卡片提醒。
	items, err := listReminders(appDB, userID, "all", "", nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 4 {
		t.Fatalf("开启时应看到 4 条，实际 %d", len(items))
	}
	week, err := listCalendarItems(appDB, userID, now.AddDate(0, 0, -1), now.AddDate(0, 0, 40), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(week) == 0 {
		t.Fatal("开启时日历里应该有卡片提醒")
	}

	setCardFeature(t, false)

	items, err = listReminders(appDB, userID, "all", "", nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Title != "普通任务" {
		t.Fatalf("关闭后只应剩普通任务，实际 %+v", items)
	}
	cals, err := listCalendarItems(appDB, userID, now.AddDate(0, 0, -1), now.AddDate(0, 0, 40), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range cals {
		if item.ListID == bucket.ID {
			t.Fatalf("关闭后日历里不该出现卡片提醒：%+v", item)
		}
	}
	// 数据一条没少：卡片、提醒、还有栏目清单本身都还在库里。
	var cards, reminders, lists int64
	appDB.Model(&Card{}).Where("user_id = ? AND deleted_at IS NULL", userID).Count(&cards)
	// 注意：普通提醒的 card_id 是 0（不是 NULL），所以这里要用 card_id > 0 来数卡片提醒。
	appDB.Model(&Reminder{}).Where("user_id = ? AND card_id > 0 AND deleted_at IS NULL", userID).Count(&reminders)
	appDB.Model(&List{}).Where("user_id = ? AND template = ? AND deleted_at IS NULL", userID, listTemplateCard).Count(&lists)
	if cards != 1 || reminders != 3 || lists != 1 {
		t.Fatalf("关闭只是隐藏，数据应保留：cards=%d reminders=%d lists=%d", cards, reminders, lists)
	}

	setCardFeature(t, true)
	items, err = listReminders(appDB, userID, "all", "", nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 4 {
		t.Fatalf("重新打开后应恢复到 4 条，实际 %d", len(items))
	}
}

// 「本周待还」：本周内到期的、已经逾期的都算；还完的不算。
func TestWeekDueCards(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	const userID = 34
	loc := cardTestLoc(t)
	bucket, err := ensureCardBucket(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	// 2026-10-07 是周三 → 本周是 10-05 ~ 10-11。
	now := time.Date(2026, time.October, 7, 9, 0, 0, 0, loc)
	makeCard := func(name string, dueDay int) Card {
		card := Card{
			UserID: userID, ListID: bucket.ID, Name: name, Bank: "自检银行",
			StatementDay: 1, DueDay: dueDay, AutoRepeat: true,
		}
		if err := appDB.Create(&card).Error; err != nil {
			t.Fatal(err)
		}
		return card
	}
	// 本周内到期（10-09 周五）
	inWeek := makeCard("本周卡", 9)
	// 已经逾期（10-06 周一，今天 10-07 已过）
	overdue := makeCard("逾期卡", 6)
	// 下周才到期（10-14）
	nextWeek := makeCard("下周卡", 14)
	// 本周内到期但**还没记金额**：也要出现（金额显示 0 → 前端显示「—」）。
	// 故意不给它 upsertStatement。
	makeCard("未记金额卡", 8)

	if _, err := upsertStatement(appDB, userID, inWeek, "2026-10", 123456, 0, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := upsertStatement(appDB, userID, overdue, "2026-10", 5000, 0, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := upsertStatement(appDB, userID, nextWeek, "2026-10", 999, 0, ""); err != nil {
		t.Fatal(err)
	}

	out, err := weekDueCards(appDB, userID, now)
	if err != nil {
		t.Fatal(err)
	}
	if out.WeekStart != "2026-10-05" || out.WeekEnd != "2026-10-11" {
		t.Fatalf("本周区间不对：%s ~ %s", out.WeekStart, out.WeekEnd)
	}
	if out.Weekday != "星期三" || out.Today != "2026-10-07" {
		t.Fatalf("日期信息不对：%s %s", out.Today, out.Weekday)
	}
	if out.Count != 3 {
		t.Fatalf("本周待还应是 3 张（本周内 + 逾期 + 未记金额），实际 %d：%+v", out.Count, out.Cards)
	}
	if out.TotalCents != 128456 {
		t.Fatalf("合计金额不对：%d", out.TotalCents)
	}
	if out.Overdue != 1 {
		t.Fatalf("应标出 1 张逾期，实际 %d", out.Overdue)
	}
	byName := map[string]WeekDueCard{}
	for _, c := range out.Cards {
		byName[c.Name] = c
	}
	if c := byName["逾期卡"]; !c.Overdue || c.DaysLeft != -1 {
		t.Fatalf("逾期卡应标逾期且 days_left=-1：%+v", c)
	}
	if c := byName["本周卡"]; c.DaysLeft != 2 || c.Tail != "" {
		t.Fatalf("本周卡应在 2 天后到期：%+v", c)
	}
	if _, ok := byName["下周卡"]; ok {
		t.Fatal("下周到期的卡不该出现在本周待还里")
	}
	if c, ok := byName["未记金额卡"]; !ok || c.AmountCents != 0 || c.DaysLeft != 1 {
		t.Fatalf("没记金额但本周到期的卡也应出现（金额 0）：%+v ok=%v", c, ok)
	}

	// 还完本期后就不再出现
	if _, err := payStatement(appDB, userID, inWeek, "2026-10", 123456, now); err != nil {
		t.Fatal(err)
	}
	out, err = weekDueCards(appDB, userID, now)
	if err != nil {
		t.Fatal(err)
	}
	if out.Count != 2 || byName2(out.Cards, "逾期卡") == nil || byName2(out.Cards, "未记金额卡") == nil {
		t.Fatalf("还完后本周待还应剩逾期卡与未记金额卡，实际 %+v", out.Cards)
	}
}

// 老数据兼容：0.13.0 之前「信用卡」是普通清单的模板，用户可能建过好几条
// （名字各式各样）。打开栏目时应把它们并成一栏：卡片都挪进来、旧清单收掉、
// 提醒重建到栏目下——不能出现「卡片页里看不到我以前的卡」。
func TestLegacyCardListsAreAdopted(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	const userID = 35
	loc := cardTestLoc(t)
	now := time.Date(2026, time.October, 7, 10, 0, 0, 0, loc)
	makeLegacy := func(name string, bank string) Card {
		list := List{UserID: userID, Name: name, Color: "blue", Icon: "list", Position: 1, Template: listTemplateCard}
		if err := appDB.Create(&list).Error; err != nil {
			t.Fatal(err)
		}
		card := Card{
			UserID: userID, ListID: list.ID, Name: "白金", Bank: bank,
			StatementDay: 5, DueDay: 25, AdvanceDays: 3, AutoRepeat: true,
		}
		if err := appDB.Create(&card).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := generateCardPlan(appDB, &card, now); err != nil {
			t.Fatal(err)
		}
		return card
	}
	first := makeLegacy("招商银行信用卡", "招商银行")
	second := makeLegacy("中信信用卡", "中信银行")

	bucket, err := ensureCardBucket(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	if bucket.ID != first.ListID {
		t.Fatalf("最老的那条应成为固定栏目：%d vs %d", bucket.ID, first.ListID)
	}
	if bucket.Name != cardBucketListName {
		t.Fatalf("栏目名应统一成 %q，实际 %q", cardBucketListName, bucket.Name)
	}
	// 两张卡都在栏目下，且各自的提醒也挂到了栏目下
	cards, err := listCards(appDB, userID, bucket.ID, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) != 2 {
		t.Fatalf("两张卡都应并进栏目，实际 %d", len(cards))
	}
	var remindersInBucket int64
	appDB.Model(&Reminder{}).
		Where("user_id = ? AND list_id = ? AND deleted_at IS NULL", userID, bucket.ID).Count(&remindersInBucket)
	if remindersInBucket != 6 {
		t.Fatalf("两张卡共 6 条提醒都应在栏目下，实际 %d", remindersInBucket)
	}
	var visibleLists int64
	appDB.Model(&List{}).
		Where("user_id = ? AND template = ? AND deleted_at IS NULL", userID, listTemplateCard).Count(&visibleLists)
	if visibleLists != 1 {
		t.Fatalf("合并后应只剩一个信用卡栏目，实际 %d", visibleLists)
	}
	var leftovers int64
	appDB.Model(&Reminder{}).
		Where("user_id = ? AND list_id = ? AND deleted_at IS NULL", userID, second.ListID).Count(&leftovers)
	if leftovers != 0 {
		t.Fatalf("旧清单下不应再留提醒，实际 %d", leftovers)
	}
	// 再调一次是幂等的
	again, err := ensureCardBucket(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != bucket.ID {
		t.Fatalf("重复调用不应换栏目：%d vs %d", again.ID, bucket.ID)
	}
	var cardsAgain int64
	appDB.Model(&Card{}).Where("user_id = ? AND deleted_at IS NULL", userID).Count(&cardsAgain)
	if cardsAgain != 2 {
		t.Fatalf("重复调用不应增删卡片：%d", cardsAgain)
	}
}

// 同步/导入的**新建**分支也要把 template 落下来：信用卡账单栏目是对端建的，
// 漏掉模板这一栏在新设备上会变成普通清单（卡片页不再认识它，卡片也就查不出来）。
func TestSyncCreatesCardBucketWithTemplate(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	seedUser(t, appDB, "同步用户", "admin")
	configureSync(t, appDB, syncDirectionPull, "http://192.168.3.99:8906", "shared-token-123")

	now := time.Now()
	snap := syncSnapshot{
		Format:     syncFormat,
		InstanceID: "peer-instance-abc",
		AppName:    "工作序记",
		Users:      []syncUser{{Username: "同步用户", Role: "admin"}},
		Lists: []syncList{{
			UID: "list-uid-cards", Owner: "同步用户", Name: cardBucketListName,
			Color: "blue", Icon: "card", Position: 2, Template: listTemplateCard,
			CreatedAt: now, UpdatedAt: now,
		}},
	}
	if _, err := applySyncSnapshot(appDB, snap); err != nil {
		t.Fatal(err)
	}
	var list List
	if err := appDB.Where("sync_uid = ?", "list-uid-cards").First(&list).Error; err != nil {
		t.Fatal(err)
	}
	if list.Template != listTemplateCard {
		t.Fatalf("同步过来的信用卡栏目模板应为 %q，实际 %q", listTemplateCard, list.Template)
	}
	if list.Name != cardBucketListName {
		t.Fatalf("栏目名不对：%q", list.Name)
	}
}

// byName2 在切片里按名字找一张卡（测试里用）。
func byName2(cards []WeekDueCard, name string) *WeekDueCard {
	for i := range cards {
		if cards[i].Name == name {
			return &cards[i]
		}
	}
	return nil
}
