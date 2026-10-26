package timetable

import (
	"net/http"
	"testing"

	"smallgo/server/database"

	"gorm.io/gorm"
)

func seedUser(t *testing.T, db *gorm.DB, id uint, name string) {
	t.Helper()
	user := database.User{ID: id, Username: name, Password: "x", Status: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user %s: %v", name, err)
	}
}

func shareID(t *testing.T, parsed map[string]interface{}) string {
	t.Helper()
	return dataID(t, parsed)
}

func TestTimetableShareReadWrite(t *testing.T) {
	db := newTestDB(t)
	seedUser(t, db, 7, "owner")
	seedUser(t, db, 8, "reader")
	seedUser(t, db, 9, "writer")

	_, created := call(t, handleCreateTable(db), http.MethodPost, `{"name":"哥哥"}`, 7, nil)
	tableID := dataID(t, created)

	status, readShare := call(t, handleAddShare(db), http.MethodPost,
		`{"username":"reader","permission":"read"}`, 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("共享只读应当 200，实际 %d（%v）", status, readShare)
	}
	status, writeShare := call(t, handleAddShare(db), http.MethodPost,
		`{"username":"writer","permission":"write"}`, 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("共享读写应当 200，实际 %d（%v）", status, writeShare)
	}

	// 接收者的表列表里出现共享表，带权限与所有者。
	_, listed := call(t, handleListTables(db), http.MethodGet, "", 8, nil)
	tables := listed["data"].(map[string]interface{})["tables"].([]interface{})
	if len(tables) != 1 {
		t.Fatalf("reader 应当看到 1 张共享表，实际 %d", len(tables))
	}
	first := tables[0].(map[string]interface{})
	if first["permission"] != PermissionRead || first["is_shared"] != true || first["owner_name"] != "owner" {
		t.Errorf("共享表权限/所有者不对：%v", first)
	}

	// 只读只能读。
	status, _ = call(t, handleGetTable(db), http.MethodGet, "", 8, params{"id": tableID})
	if status != http.StatusOK {
		t.Errorf("只读账号读表应当 200，实际 %d", status)
	}
	status, _ = call(t, handleCreateEntry(db), http.MethodPost,
		`{"title":"数学","weekday":1,"start_time":"08:00","end_time":"08:45"}`, 8, params{"id": tableID})
	if status != http.StatusForbidden {
		t.Errorf("只读账号建条目应当 403，实际 %d", status)
	}
	status, _ = call(t, handleUpdateTable(db), http.MethodPatch, `{"name":"改名"}`, 8, params{"id": tableID})
	if status != http.StatusNotFound {
		t.Errorf("共享账号改表设置应当 404，实际 %d", status)
	}
	status, _ = call(t, handleAddShare(db), http.MethodPost, `{"username":"reader","permission":"write"}`, 8, params{"id": tableID})
	if status != http.StatusForbidden {
		t.Errorf("共享账号再共享应当 403，实际 %d", status)
	}

	// 读写可以增删改条目，条目仍归表的所有者。
	status, entry := call(t, handleCreateEntry(db), http.MethodPost,
		`{"title":"数学","weekday":1,"start_time":"08:00","end_time":"08:45"}`, 9, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("读写账号建条目应当 200，实际 %d（%v）", status, entry)
	}
	entryID := dataID(t, entry)
	var stored TimetableEntry
	db.First(&stored, entryID)
	if stored.UserID != 7 {
		t.Errorf("共享写入的条目应归表主，实际 user_id=%d", stored.UserID)
	}
	status, _ = call(t, handleUpdateEntry(db), http.MethodPatch, `{"title":"数学（改）"}`, 8, params{"id": entryID})
	if status != http.StatusForbidden {
		t.Errorf("只读账号改条目应当 403，实际 %d", status)
	}
	status, _ = call(t, handleUpdateEntry(db), http.MethodPatch, `{"title":"数学（改）"}`, 9, params{"id": entryID})
	if status != http.StatusOK {
		t.Errorf("读写账号改条目应当 200，实际 %d", status)
	}
	status, _ = call(t, handleDeleteEntry(db), http.MethodDelete, "", 8, params{"id": entryID})
	if status != http.StatusForbidden {
		t.Errorf("只读账号删条目应当 403，实际 %d", status)
	}

	// 所有者能看到并修改共享列表。
	_, sharesResp := call(t, handleListShares(db), http.MethodGet, "", 7, params{"id": tableID})
	shares := sharesResp["data"].(map[string]interface{})["shares"].([]interface{})
	if len(shares) != 2 {
		t.Fatalf("应当有 2 条共享，实际 %d", len(shares))
	}
	status, _ = call(t, handleUpdateShare(db), http.MethodPatch, `{"permission":"read"}`,
		7, params{"id": shareID(t, writeShare)})
	if status != http.StatusOK {
		t.Errorf("改共享权限应当 200，实际 %d", status)
	}

	// 降为只读后不能再写。
	status, _ = call(t, handleCreateEntry(db), http.MethodPost,
		`{"title":"英语","weekday":2,"start_time":"09:00","end_time":"09:45"}`, 9, params{"id": tableID})
	if status != http.StatusForbidden {
		t.Errorf("降为只读后建条目应当 403，实际 %d", status)
	}

	// 重复共享、共享给自己、找不到账号都要拒。
	for _, body := range []string{
		`{"username":"reader","permission":"write"}`,
		`{"username":"owner","permission":"read"}`,
		`{"username":"nobody","permission":"read"}`,
		`{"username":"writer","permission":"admin"}`,
	} {
		if status, resp := call(t, handleAddShare(db), http.MethodPost, body, 7, params{"id": tableID}); status != http.StatusBadRequest {
			t.Errorf("非法共享 %s 应当 400，实际 %d（%v）", body, status, resp)
		}
	}

	// 移除共享后接收者看不到。
	status, _ = call(t, handleDeleteShare(db), http.MethodDelete, "",
		7, params{"id": shareID(t, readShare)})
	if status != http.StatusOK {
		t.Fatalf("移除共享应当 200，实际 %d", status)
	}
	status, _ = call(t, handleGetTable(db), http.MethodGet, "", 8, params{"id": tableID})
	if status != http.StatusNotFound {
		t.Errorf("移除共享后读表应当 404，实际 %d", status)
	}
}

func TestTimetableShareOwnerOnlyAndCascade(t *testing.T) {
	db := newTestDB(t)
	seedUser(t, db, 7, "owner")
	seedUser(t, db, 8, "reader")

	_, created := call(t, handleCreateTable(db), http.MethodPost, `{"name":"哥哥"}`, 7, nil)
	tableID := dataID(t, created)
	_, shared := call(t, handleAddShare(db), http.MethodPost,
		`{"username":"reader","permission":"write"}`, 7, params{"id": tableID})
	sid := shareID(t, shared)

	// 接收者不能看共享名单，也不能改/删共享记录。
	if status, _ := call(t, handleListShares(db), http.MethodGet, "", 8, params{"id": tableID}); status != http.StatusForbidden {
		t.Errorf("接收者看共享名单应当 403，实际 %d", status)
	}
	if status, _ := call(t, handleUpdateShare(db), http.MethodPatch, `{"permission":"read"}`, 8, params{"id": sid}); status != http.StatusNotFound {
		t.Errorf("接收者改共享应当 404，实际 %d", status)
	}
	if status, _ := call(t, handleDeleteShare(db), http.MethodDelete, "", 8, params{"id": sid}); status != http.StatusNotFound {
		t.Errorf("接收者删共享应当 404，实际 %d", status)
	}

	// 删表级联删共享。
	if status, _ := call(t, handleDeleteTable(db), http.MethodDelete, "", 7, params{"id": tableID}); status != http.StatusOK {
		t.Fatalf("删表应当 200，实际 %d", status)
	}
	var left int64
	db.Model(&TimetableShare{}).Where("timetable_id = ?", tableID).Count(&left)
	if left != 0 {
		t.Errorf("删表后共享记录应清空，实际剩 %d", left)
	}
}
