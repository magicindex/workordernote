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

// setCardFeature 改**某个用户自己的**偏好（信用卡栏目现在是个人开关，默认关）。
func setCardFeature(t *testing.T, userID uint, on bool) {
	t.Helper()
	value := "true"
	if !on {
		value = "false"
	}
	if err := sysconfig.UpdateConfig(appDB, "credit_card_enabled", value, userID); err != nil {
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
	// （这段只验证落库位置，与个人开关无关。）
	var remindersInBucket int64
	if err := appDB.Model(&Reminder{}).
		Where("user_id = ? AND list_id = ? AND deleted_at IS NULL", 32, bucket.ID).
		Count(&remindersInBucket).Error; err != nil {
		t.Fatal(err)
	}
	if remindersInBucket != 1 {
		t.Fatalf("卡包清单里应该只有 1 条还款日提醒（账单日/提前提醒都不再生成），实际 %d", remindersInBucket)
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

	// 注册表默认是**开**的（用户要求：信用卡账单与记事本都默认开启；每个用户
	// 仍可在偏好设置里关掉）。先确认默认值，再关掉/打开验证「关掉只是隐藏」。
	if !creditCardFeatureEnabled(appDB, userID) {
		t.Fatal("个人偏好注册表默认应为开启")
	}
	setCardFeature(t, userID, true)

	// 开着的时候：4 条（3 条卡片提醒 + 1 条普通任务），日历里也应该有卡片提醒。
	items, err := listReminders(appDB, userID, "all", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("开启时应看到 2 条（1 条卡片还款提醒 + 1 条普通任务），实际 %d", len(items))
	}
	week, err := listCalendarItems(appDB, userID, now.AddDate(0, 0, -1), now.AddDate(0, 0, 40), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(week) == 0 {
		t.Fatal("开启时日历里应该有卡片提醒")
	}
	// 日历项要带上 card_id：前端靠 card_role 上色、靠 card_id 关联回卡片。
	// （这个字段曾被漏掉，返回的 card_id 一直是空——由 verify-097 的日历断言抓出来。）
	linked := false
	for _, c := range week {
		if c.CardID == card.ID && c.CardRole != "" {
			linked = true
		}
	}
	if !linked {
		t.Fatalf("日历项应带上 card_id 与 card_role：%+v", week[:min(3, len(week))])
	}

	setCardFeature(t, userID, false)
	if creditCardFeatureEnabled(appDB, userID) {
		t.Fatal("关掉之后读取应为关闭")
	}

	items, err = listReminders(appDB, userID, "all", "", nil, false, "", "", "")
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
	if cards != 1 || reminders != 1 || lists != 1 {
		t.Fatalf("关闭只是隐藏，数据应保留：cards=%d reminders=%d lists=%d", cards, reminders, lists)
	}

	setCardFeature(t, userID, true)
	items, err = listReminders(appDB, userID, "all", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("重新打开后应恢复到 2 条，实际 %d", len(items))
	}
}

// 「账单已出」的头部卡片：账单日过了且当期没还的才进来；
// 排序是「红色（逾期或 ≤3 天）最前 → 账单日早的在前 → 还款日近的在前」。
func TestBillingCards(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	const userID = 34
	loc := cardTestLoc(t)
	bucket, err := ensureCardBucket(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	// 2026-10-08（周四）
	now := time.Date(2026, time.October, 8, 9, 0, 0, 0, loc)
	makeCard := func(name string, statementDay, dueDay int) Card {
		card := Card{
			UserID: userID, ListID: bucket.ID, Name: name, Bank: "自检银行",
			StatementDay: statementDay, DueDay: dueDay, AutoRepeat: true,
		}
		if err := appDB.Create(&card).Error; err != nil {
			t.Fatal(err)
		}
		return card
	}
	// 账单已出、离还款日还有 17 天（10-25）→ 黄色档，排后面
	normal := makeCard("普通卡", 5, 25)
	// 账单已出、还有 2 天到期（10-10）→ 红色，排最前
	urgent := makeCard("紧急卡", 1, 10)
	// 跨月卡：账单日 25 / 还款日 19 → 当期是 9 月账单，10-19 还款（还有 11 天，黄色档）
	cross := makeCard("跨月卡", 25, 19)
	// 账单日还没到（15 号才出账，今天 8 号）→ 不进来
	makeCard("账单未出卡", 15, 28)
	// 已还清的那一期 → 不进来
	paid := makeCard("已还卡", 1, 12)

	if _, err := upsertStatement(appDB, userID, normal, "2026-10", 123456, 0, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := upsertStatement(appDB, userID, urgent, "2026-10", 5000, 0, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := upsertStatement(appDB, userID, cross, "2026-09", 7777, 0, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := upsertStatement(appDB, userID, paid, "2026-10", 999, 0, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := payStatement(appDB, userID, paid, "2026-10", 999, now); err != nil {
		t.Fatal(err)
	}

	out, err := billingCards(appDB, userID, now)
	if err != nil {
		t.Fatal(err)
	}
	if out.Today != "2026-10-08" || out.Weekday != "星期四" {
		t.Fatalf("日期信息不对：%s %s", out.Today, out.Weekday)
	}
	if out.Count != 3 {
		t.Fatalf("账单已出且未还的应有 3 张，实际 %d：%+v", out.Count, out.Cards)
	}
	names := make([]string, 0, len(out.Cards))
	for _, c := range out.Cards {
		names = append(names, c.Name)
	}
	if names[0] != "紧急卡" {
		t.Fatalf("红色的（≤3 天）应排最前，实际顺序 %v", names)
	}
	if out.Urgent != 1 || out.Overdue != 0 {
		t.Fatalf("红色张数应为 1、逾期 0，实际 urgent=%d overdue=%d", out.Urgent, out.Overdue)
	}
	// 其余按账单日：跨月卡（9-25）在普通卡（10-05）之前
	if names[1] != "跨月卡" || names[2] != "普通卡" {
		t.Fatalf("其余应按账单日由早到晚，实际顺序 %v", names)
	}
	byName := map[string]BillingCard{}
	for _, c := range out.Cards {
		byName[c.Name] = c
	}
	if c := byName["紧急卡"]; !c.Urgent || c.DaysLeft != 2 || c.StatementDate != "2026-10-01" {
		t.Fatalf("紧急卡信息不对：%+v", c)
	}
	if c, ok := byName["跨月卡"]; !ok || c.Period != "2026-09" || c.DueDate != "2026-10-19" || c.StatementDate != "2026-09-25" {
		t.Fatalf("跨月卡应落在 2026-09 这一期：%+v ok=%v", c, ok)
	}
	if out.TotalCents != 123456+5000+7777 {
		t.Fatalf("合计金额不对：%d", out.TotalCents)
	}

	// 逾期的那张（还款日已过、没还）算红色，且排最前
	late := makeCard("逾期卡", 1, 5)
	if _, err := upsertStatement(appDB, userID, late, "2026-10", 100, 0, ""); err != nil {
		t.Fatal(err)
	}
	out, err = billingCards(appDB, userID, now)
	if err != nil {
		t.Fatal(err)
	}
	if out.Cards[0].Name != "逾期卡" || !out.Cards[0].Overdue || out.Cards[0].DaysLeft != -3 {
		t.Fatalf("逾期的应排最前并标逾期：%+v", out.Cards[0])
	}
	if out.Overdue != 1 || out.Urgent != 2 {
		t.Fatalf("逾期 1、红色 2，实际 %d / %d", out.Overdue, out.Urgent)
	}
}
