package reminder

import (
	"testing"
	"time"
)

// 提醒自己的颜色要能存、能改、能清空；乱填的颜色必须在入库前被拒。
func TestReminderColorPersistsAndValidates(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	due := time.Now().Add(time.Hour).Truncate(time.Second)
	violet := "violet"
	created, err := createReminder(appDB, 91, SaveReminderInput{
		Title: "颜色自检", DueAt: &due, RepeatRule: "none", Color: &violet,
		Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Color != "violet" {
		t.Fatalf("创建后颜色 = %q，期望 violet", created.Color)
	}

	empty := ""
	updated, err := updateReminder(appDB, 91, created.ID, SaveReminderInput{
		Title: created.Title, DueAt: created.DueAt, RepeatRule: "none",
		ListID: created.ListID, Version: created.Version, Color: &empty,
		Channels: created.Channels,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Color != "" {
		t.Fatalf("清空后颜色 = %q，期望空串", updated.Color)
	}

	bad := "pink"
	if _, err := createReminder(appDB, 91, SaveReminderInput{
		Title: "乱填颜色", DueAt: &due, RepeatRule: "none", Color: &bad,
		Channels: []string{ChannelInApp},
	}); err == nil {
		t.Fatal("非法颜色不应入库")
	}
}
