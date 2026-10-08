package reminder

import (
	"testing"
	"time"
)

// 记事（KindNote）的核心语义：创建即完成、不排期、不通知，
// 且任务与记事可以互相切换。这些断言锁住的是本期新增的行为。
func TestNoteIsCompletedOnCreationAndNeverSchedules(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	due := time.Now().Add(2 * time.Hour).Truncate(time.Second)
	note, err := createReminder(appDB, 7, SaveReminderInput{
		Title: "记一笔", Kind: KindNote,
		// 旧客户端可能仍然带着排期字段，记事必须把它们全部忽略。
		DueAt: &due, RepeatRule: "daily", RepeatNotifyMinutes: 30, Priority: 3,
		Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	if note.Kind != KindNote {
		t.Fatalf("kind = %q, want %q", note.Kind, KindNote)
	}
	if note.CompletedAt == nil {
		t.Fatal("记事应在创建时就标记为已完成")
	}
	if note.DueAt != nil {
		t.Fatalf("记事不该保留到期时间，实际为 %v", note.DueAt)
	}
	if note.RepeatRule != "none" {
		t.Fatalf("记事不该重复，实际为 %q", note.RepeatRule)
	}
	if note.Priority != 0 {
		t.Fatalf("记事不该保留优先级，实际为 %d", note.Priority)
	}
	if note.RepeatNotifyMinutes != 0 {
		t.Fatalf("记事不该有催办间隔，实际为 %d", note.RepeatNotifyMinutes)
	}

	var jobs int64
	if err := appDB.Model(&DeliveryJob{}).Where("reminder_id = ?", note.ID).Count(&jobs).Error; err != nil {
		t.Fatal(err)
	}
	if jobs != 0 {
		t.Fatalf("记事不该产生投递任务，实际有 %d 条", jobs)
	}

	// 记事只应出现在「已完成」，不得进入任何未完成视图。
	for _, view := range []string{"all", "today", "planned"} {
		rows, err := listReminders(appDB, 7, view, "", nil, false, "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 0 {
			t.Fatalf("view=%s 不该出现记事，实际有 %d 条", view, len(rows))
		}
	}
	done, err := listReminders(appDB, 7, "completed", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(done) != 1 || done[0].ID != note.ID {
		t.Fatalf("记事应出现在「已完成」，实际为 %+v", done)
	}
}

func TestSwitchingBetweenTaskAndNoteMovesCompletedAt(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	task, err := createReminder(appDB, 8, SaveReminderInput{Title: "任务", Kind: KindTask})
	if err != nil {
		t.Fatal(err)
	}
	if task.CompletedAt != nil {
		t.Fatal("新建的任务应为未完成")
	}

	// 任务 -> 记事：立即完成。
	asNote, err := updateReminder(appDB, 8, task.ID, SaveReminderInput{
		Title: task.Title, Kind: KindNote, Version: task.Version,
	})
	if err != nil {
		t.Fatal(err)
	}
	if asNote.Kind != KindNote || asNote.CompletedAt == nil {
		t.Fatalf("任务改为记事后应已完成，实际 kind=%q completed=%v", asNote.Kind, asNote.CompletedAt)
	}
	firstCompleted := asNote.CompletedAt.Unix()

	// 之后编辑记事不能再动完成时间，否则「已完成」的排序会跳。
	edited, err := updateReminder(appDB, 8, task.ID, SaveReminderInput{
		Title: "改了标题", Kind: KindNote, Version: asNote.Version,
	})
	if err != nil {
		t.Fatal(err)
	}
	if edited.CompletedAt == nil || edited.CompletedAt.Unix() != firstCompleted {
		t.Fatalf("编辑记事不该改变完成时间，实际 %v，期望 %d", edited.CompletedAt, firstCompleted)
	}

	// 记事 -> 任务：回到未完成。
	backToTask, err := updateReminder(appDB, 8, task.ID, SaveReminderInput{
		Title: edited.Title, Kind: KindTask, Version: edited.Version,
	})
	if err != nil {
		t.Fatal(err)
	}
	if backToTask.Kind != KindTask || backToTask.CompletedAt != nil {
		t.Fatalf("记事改回任务后应重新变为未完成，实际 kind=%q completed=%v", backToTask.Kind, backToTask.CompletedAt)
	}
}

func TestNoteIgnoresCompleteAndRejectsRestore(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	note, err := createReminder(appDB, 9, SaveReminderInput{Title: "记事", Kind: KindNote})
	if err != nil {
		t.Fatal(err)
	}
	completed := note.CompletedAt.Unix()

	// 对记事调用 complete 应是空操作（旧前端可能仍然显示那个勾）。
	after, err := completeReminder(appDB, 9, note.ID)
	if err != nil {
		t.Fatalf("对记事调用 complete 应为空操作，实际报错 %v", err)
	}
	if after.CompletedAt == nil || after.CompletedAt.Unix() != completed {
		t.Fatalf("complete 不该改变记事，实际 %v", after.CompletedAt)
	}

	// 对记事调用 restore 必须明确失败，避免悄悄变成没有日期的未完成任务。
	if _, err := restoreReminder(appDB, 9, note.ID); err == nil {
		t.Fatal("对记事调用 restore 应被拒绝")
	}
}

func TestUnknownKindIsRejected(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	if _, err := createReminder(appDB, 10, SaveReminderInput{Title: "x", Kind: "memo"}); err == nil {
		t.Fatal("未知的类型应被拒绝")
	}
}
