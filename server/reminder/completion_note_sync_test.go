package reminder

import (
	"testing"
	"time"
)

// 完成备注与同步的几条边界（2026-11-12 加的字段，混版本同步最容易把它擦掉）：
//   - 旧版本对端不认识 completed_note / note，回传时是空串：不能当成「对方清空了」；
//   - 升级前就同步过来的完成记录没有 note，后续同步要能补写；
//   - 同一条提醒重复完成时，空备注不能覆盖已有备注；
//   - 任务 ↔ 记事 切类型时备注跟着清掉。
//
// 这几条都是「数据静默丢失」类问题，用例钉住比靠人工检查可靠。

// 旧对端（快照里 completed_note 为空）不能把本机的完成备注擦掉。
func TestSyncKeepsCompletionNoteAgainstOldPeer(t *testing.T) {
	withShanghaiLocal(t)
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "王耀辉", "admin")
	seedUser(t, dbB, "王耀辉", "admin")

	list, err := ensureDefaultList(dbA, userA.ID)
	if err != nil {
		t.Fatal(err)
	}
	due := time.Now().Add(time.Hour).Truncate(time.Second)
	created, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "换电瓶", ListID: list.ID, DueAt: &due, RepeatRule: "none",
		Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminderWithNote(dbA, userA.ID, created.ID, "旧的留在车库"); err != nil {
		t.Fatal(err)
	}

	snap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, snap); err != nil {
		t.Fatal(err)
	}
	var onB Reminder
	if err := dbB.Where("title = ?", "换电瓶").First(&onB).Error; err != nil {
		t.Fatal(err)
	}
	if onB.CompletedNote != "旧的留在车库" {
		t.Fatalf("首次同步应带上完成备注，实际 %q", onB.CompletedNote)
	}

	// 模拟「对端是旧版本」：报文里这个字段永远缺省（空串）。
	for i := range snap.Reminders {
		snap.Reminders[i].CompletedNote = ""
	}
	stats, err := applySyncSnapshot(dbB, snap)
	if err != nil {
		t.Fatal(err)
	}
	if err := dbB.Where("id = ?", onB.ID).First(&onB).Error; err != nil {
		t.Fatal(err)
	}
	if onB.CompletedNote != "旧的留在车库" {
		t.Fatalf("旧版本对端的空备注不该擦掉本机备注，实际 %q", onB.CompletedNote)
	}
	if stats.total() != 0 {
		t.Fatalf("旧对端的空备注应被视为「同一条」，不该产生改动：%+v", stats)
	}
}

// 升级前就存在（或首轮同步先到）的完成记录，后续同步要能补上备注。
func TestSyncBackfillsCompletionNoteOnHistory(t *testing.T) {
	withShanghaiLocal(t)
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "王耀辉", "admin")
	seedUser(t, dbB, "王耀辉", "admin")

	list, err := ensureDefaultList(dbA, userA.ID)
	if err != nil {
		t.Fatal(err)
	}
	due := time.Now().Add(time.Hour).Truncate(time.Second)
	created, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "每月对账", ListID: list.ID, DueAt: &due, RepeatRule: "monthly",
		Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminderWithNote(dbA, userA.ID, created.ID, "本月对完了"); err != nil {
		t.Fatal(err)
	}
	snap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Completions) != 1 {
		t.Fatalf("应有一条完成记录，实际 %d", len(snap.Completions))
	}

	// 第一次同步：装成旧版本（没有 note）→ 对端建出一条没有备注的历史行。
	snap.Completions[0].Note = ""
	if _, err := applySyncSnapshot(dbB, snap); err != nil {
		t.Fatal(err)
	}
	var row Completion
	if err := dbB.Unscoped().First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Note != "" {
		t.Fatalf("第一次同步不该有备注，实际 %q", row.Note)
	}

	// 第二次同步带上备注：补写到已有历史行上，而不是跳过。
	snap.Completions[0].Note = "本月对完了"
	stats, err := applySyncSnapshot(dbB, snap)
	if err != nil {
		t.Fatal(err)
	}
	if err := dbB.Unscoped().First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Note != "本月对完了" {
		t.Fatalf("第二次同步应补写备注，实际 %q", row.Note)
	}
	if stats.CompletionsUpdated != 1 {
		t.Fatalf("补写应计入 completions_updated，实际 %+v", stats)
	}
}

// 重复完成（客户端重试/双击）：空备注不能把已有备注冲掉；带了新备注才覆盖。
func TestCompleteReminderTwiceKeepsNote(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 31
	item, err := createReminder(appDB, userID, SaveReminderInput{Title: "重复完成"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminderWithNote(appDB, userID, item.ID, "第一次的备注"); err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminder(appDB, userID, item.ID); err != nil {
		t.Fatal(err)
	}
	var again Reminder
	if err := appDB.First(&again, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if again.CompletedNote != "第一次的备注" {
		t.Fatalf("重复完成（不带备注）不该清掉备注，实际 %q", again.CompletedNote)
	}
	if _, err := completeReminderWithNote(appDB, userID, item.ID, "改过的备注"); err != nil {
		t.Fatal(err)
	}
	if err := appDB.First(&again, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if again.CompletedNote != "改过的备注" {
		t.Fatalf("带了新备注应覆盖，实际 %q", again.CompletedNote)
	}
}

// 任务 ↔ 记事 切类型：完成备注跟着清掉（记事没有「完成」这回事）。
func TestKindSwitchClearsCompletionNote(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 32
	item, err := createReminder(appDB, userID, SaveReminderInput{Title: "切类型"})
	if err != nil {
		t.Fatal(err)
	}
	done, err := completeReminderWithNote(appDB, userID, item.ID, "写下来的备注")
	if err != nil {
		t.Fatal(err)
	}
	if done.CompletedNote != "写下来的备注" {
		t.Fatalf("前提不成立：完成备注没写进去（%q）", done.CompletedNote)
	}

	asNote, err := updateReminder(appDB, userID, item.ID, SaveReminderInput{
		Title: done.Title, Kind: KindNote, ListID: done.ListID, RepeatRule: "none", Version: done.Version,
	})
	if err != nil {
		t.Fatal(err)
	}
	if asNote.CompletedNote != "" {
		t.Fatalf("改成记事应清掉完成备注，实际 %q", asNote.CompletedNote)
	}

	back, err := updateReminder(appDB, userID, item.ID, SaveReminderInput{
		Title: asNote.Title, Kind: KindTask, ListID: asNote.ListID, RepeatRule: "none", Version: asNote.Version,
	})
	if err != nil {
		t.Fatal(err)
	}
	if back.CompletedNote != "" || back.CompletedAt != nil {
		t.Fatalf("改回任务后应是「未完成、没有完成备注」，实际 %+v", back.CompletedNote)
	}
}
