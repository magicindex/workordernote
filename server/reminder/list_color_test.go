package reminder

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// 清单颜色是「侧栏圆点 / 列表页任务标题 / 日历色块」三处共用的一个值：
// 列表接口必须把清单颜色带给前端，改颜色后同一个清单的任务立刻拿到新颜色。
func TestListRemindersCarriesListColor(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 51
	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	if err := appDB.Model(&List{}).Where("id = ?", list.ID).
		UpdateColumn("color", "violet").Error; err != nil {
		t.Fatal(err)
	}
	due := ptrTime(time.Now().AddDate(0, 0, 1).Truncate(time.Second))
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "带颜色返回的任务", ListID: list.ID, DueAt: due, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}

	items, err := listReminders(appDB, userID, "all", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("应有 1 条，实际 %d", len(items))
	}
	if items[0].ListColor != "violet" {
		t.Fatalf("列表接口应带上清单颜色 violet，实际 %q", items[0].ListColor)
	}

	// 换颜色（等价于侧栏「编辑清单」里改色）：同一个接口立刻返回新颜色。
	if err := appDB.Model(&List{}).Where("id = ?", list.ID).
		UpdateColumn("color", "amber").Error; err != nil {
		t.Fatal(err)
	}
	items, err = listReminders(appDB, userID, "all", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if items[0].ListColor != "amber" {
		t.Fatalf("改色后应返回 amber，实际 %q", items[0].ListColor)
	}
	// 单条读取（编辑面板打开时用）也要带上颜色。
	single, err := getReminder(appDB, userID, items[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if single.ListColor != "amber" {
		t.Fatalf("单条接口应带上清单颜色，实际 %q", single.ListColor)
	}
}

// 颜色白名单：只认前端色表里的五个名字，脏值不许写进库。
func TestListColorValidationAndHandler(t *testing.T) {
	for _, ok := range []string{"blue", "violet", "rose", "amber", "emerald", ""} {
		if err := validateListColor(ok); err != nil {
			t.Fatalf("颜色 %q 应当被接受，实际报错 %v", ok, err)
		}
	}
	for _, bad := range []string{"red", "BLUE", "#3182f6", "紫"} {
		if err := validateListColor(bad); err == nil {
			t.Fatalf("颜色 %q 应当被拒绝", bad)
		}
	}

	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)

	const userID = 52
	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	patch := func(body string) int {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPatch, "/api/reminder/lists/1", strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		ctx.Params = gin.Params{{Key: "id", Value: strconv.FormatUint(uint64(list.ID), 10)}}
		ctx.Set("userID", userID)
		handleUpdateList(appDB)(ctx)
		return recorder.Code
	}
	if code := patch(`{"color":"rose"}`); code != http.StatusOK {
		t.Fatalf("合法颜色应当 200，实际 %d", code)
	}
	var after List
	if err := appDB.First(&after, list.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Color != "rose" {
		t.Fatalf("颜色应更新为 rose，实际 %q", after.Color)
	}
	if code := patch(`{"color":"chartreuse"}`); code != http.StatusBadRequest {
		t.Fatalf("非法颜色应当 400，实际 %d", code)
	}
	if err := appDB.First(&after, list.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Color != "rose" {
		t.Fatalf("非法颜色不该写库，颜色仍应为 rose，实际 %q", after.Color)
	}
}
