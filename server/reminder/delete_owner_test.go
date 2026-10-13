package reminder

import (
	"testing"
	"time"
)

// 「删除只对创建提醒用户有效」（用户 2026-10-13 要求）：
//   · 别的账号调删除接口删不掉（服务端按 user_id 过滤）；
//   · DTO 里的 can_delete 如实反映「当前请求用户能不能删」。
func TestDeleteOnlyByOwner(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const owner, other = 361, 362
	due := time.Now().Add(time.Hour)
	created, err := createReminder(appDB, owner, SaveReminderInput{
		Title: "只有我能删", Kind: KindTask, DueAt: &due, RepeatRule: "none", Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatalf("创建失败：%v", err)
	}
	if !created.CanDelete {
		t.Fatal("创建者看到的 can_delete 应为 true")
	}

	// 不是创建者：删不掉，条目还在
	if err := deleteReminder(appDB, other, created.ID); err == nil {
		t.Fatal("别的账号不该能删掉这条提醒")
	}
	var stillThere int64
	if err := appDB.Model(&Reminder{}).
		Where("id = ? AND user_id = ? AND deleted_at IS NULL", created.ID, owner).
		Count(&stillThere).Error; err != nil {
		t.Fatal(err)
	}
	if stillThere != 1 {
		t.Fatalf("被别人删过之后这条应该还在，实际 %d", stillThere)
	}
	// 别人的视角里根本看不到这条（列表按 user_id 过滤）→ 也就谈不上 can_delete
	items, err := listReminders(appDB, other, "all", "", nil, true, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ID == created.ID {
			t.Fatal("别的账号不该在列表里看到这条")
		}
	}

	// 创建者自己删得掉
	if err := deleteReminder(appDB, owner, created.ID); err != nil {
		t.Fatalf("创建者应该能删：%v", err)
	}
	if err := appDB.Model(&Reminder{}).
		Where("id = ? AND user_id = ? AND deleted_at IS NULL", created.ID, owner).
		Count(&stillThere).Error; err != nil {
		t.Fatal(err)
	}
	if stillThere != 0 {
		t.Fatalf("创建者删除后不该还在，实际 %d", stillThere)
	}
}
