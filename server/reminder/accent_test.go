package reminder

import "testing"

// 仪式感卡片的过渡色（用户 2026-10-11 要求：卡片适配多种过渡色、可自行选择）：
// 创建时带上、编辑时不传要保留、传非法值要被拒。
func TestReminderAccentRoundTrip(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 421
	accent := "violet"
	created, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "生日", Kind: KindTask, Accent: &accent, RepeatRule: "yearly",
	})
	if err != nil {
		t.Fatalf("创建失败：%v", err)
	}
	if created.Accent != "violet" {
		t.Fatalf("创建后 accent 应为 violet，实际 %q", created.Accent)
	}

	// 编辑时不带 accent（通用编辑器就是这样）→ 保留原值
	updated, err := updateReminder(appDB, userID, created.ID, SaveReminderInput{
		Title: "生日（改名）", Kind: KindTask, ListID: created.ListID, RepeatRule: "yearly",
		Version: created.Version,
	})
	if err != nil {
		t.Fatalf("更新失败：%v", err)
	}
	if updated.Accent != "violet" {
		t.Fatalf("未传 accent 时应保留 violet，实际 %q", updated.Accent)
	}

	// 传空字符串 = 清掉
	empty := ""
	cleared, err := updateReminder(appDB, userID, created.ID, SaveReminderInput{
		Title: "生日（改名）", Kind: KindTask, ListID: created.ListID, RepeatRule: "yearly",
		Accent: &empty, Version: updated.Version,
	})
	if err != nil {
		t.Fatalf("清除失败：%v", err)
	}
	if cleared.Accent != "" {
		t.Fatalf("传空应清掉，实际 %q", cleared.Accent)
	}

	// 非法色名要被拒
	bad := "rainbow"
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "非法色", Kind: KindTask, Accent: &bad, RepeatRule: "none",
	}); err == nil {
		t.Fatal("非法过渡色应当被拒")
	}
	for _, ok := range []string{"rose", "amber", "orange", "emerald", "teal", "sky", "indigo", "violet", "fuchsia", "slate", ""} {
		if err := validateAccent(ok); err != nil {
			t.Fatalf("%q 应当合法：%v", ok, err)
		}
	}
	for _, bad := range []string{"red", "blue", "RAINBOW", "玫瑰"} {
		if err := validateAccent(bad); err == nil {
			t.Fatalf("%q 应当非法", bad)
		}
	}
}
