package reminder

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"smallgo/server/sysconfig"
)

func summaryTrash(t *testing.T, userID uint) int64 {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/reminder/summary", nil)
	context.Set("userID", userID)
	handleSummary(appDB)(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("summary 返回 %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data map[string]int64 `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Data["trash"]
}

func TestClearTrashMarksPurgedAndHidesFromTrash(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 11
	due := time.Now().Add(time.Hour).Truncate(time.Second)
	item, err := createReminder(appDB, userID, SaveReminderInput{Title: "清空测试", DueAt: &due})
	if err != nil {
		t.Fatal(err)
	}
	if err := deleteReminder(appDB, userID, item.ID); err != nil {
		t.Fatal(err)
	}
	if got := summaryTrash(t, userID); got != 1 {
		t.Fatalf("summary.trash = %d; want 1 after delete", got)
	}

	n, err := clearTrash(appDB, userID, time.Now())
	if err != nil || n != 1 {
		t.Fatalf("clearTrash = %d, %v; want 1, nil", n, err)
	}
	var row Reminder
	if err := appDB.Unscoped().First(&row, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.DeletedAt == nil || row.PurgedAt == nil {
		t.Fatalf("expected deleted + purged tombstones, got deleted=%v purged=%v", row.DeletedAt, row.PurgedAt)
	}

	var visible int64
	if err := appDB.Unscoped().Model(&Reminder{}).
		Where("user_id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL", userID).
		Count(&visible).Error; err != nil {
		t.Fatal(err)
	}
	if visible != 0 {
		t.Fatalf("purged item still visible in trash: %d", visible)
	}
	if got := summaryTrash(t, userID); got != 0 {
		t.Fatalf("summary.trash = %d; want 0 after clear", got)
	}
	if _, err := restoreDeletedReminder(appDB, userID, item.ID); err == nil {
		t.Fatal("purged item should not be restorable")
	}
}

func TestPurgeExpiredTrashUsesRetentionDays(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 12
	if err := sysconfig.UpdateConfig(appDB, "trash_auto_clear_days", "7", userID); err != nil {
		t.Fatal(err)
	}
	due := time.Now().Add(time.Hour).Truncate(time.Second)
	oldItem, err := createReminder(appDB, userID, SaveReminderInput{Title: "十天前删除", DueAt: &due})
	if err != nil {
		t.Fatal(err)
	}
	newItem, err := createReminder(appDB, userID, SaveReminderInput{Title: "刚删除", DueAt: &due})
	if err != nil {
		t.Fatal(err)
	}
	if err := deleteReminder(appDB, userID, oldItem.ID); err != nil {
		t.Fatal(err)
	}
	if err := deleteReminder(appDB, userID, newItem.ID); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-10 * 24 * time.Hour)
	if err := appDB.Unscoped().Model(&Reminder{}).Where("id = ?", oldItem.ID).
		Updates(map[string]interface{}{"deleted_at": old, "updated_at": old}).Error; err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	n, err := purgeExpiredTrash(appDB, userID, now)
	if err != nil || n != 1 {
		t.Fatalf("purgeExpiredTrash = %d, %v; want 1, nil", n, err)
	}
	var oldRow, newRow Reminder
	if err := appDB.Unscoped().First(&oldRow, oldItem.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := appDB.Unscoped().First(&newRow, newItem.ID).Error; err != nil {
		t.Fatal(err)
	}
	if oldRow.PurgedAt == nil {
		t.Fatal("old trash item should be purged")
	}
	if newRow.PurgedAt != nil {
		t.Fatal("recent trash item should remain")
	}
}
