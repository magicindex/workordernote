package reminder

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"smallgo/server/scheduler"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func TestBackgroundJobsAvoidAggressiveDatabasePolling(t *testing.T) {
	want := map[string]time.Duration{
		"reminder-delivery":   time.Minute,
		"reminder-qq-gateway": 30 * time.Second,
	}
	for _, job := range scheduler.All() {
		if interval, ok := want[job.Name]; ok {
			if job.Interval != interval {
				t.Fatalf("job %s interval = %s, want %s", job.Name, job.Interval, interval)
			}
			delete(want, job.Name)
		}
	}
	if len(want) != 0 {
		t.Fatalf("missing reminder jobs: %#v", want)
	}
}

func TestListListsUsesFixedQueryCount(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 71
	lists := []List{
		{UserID: userID, Name: "默认", IsDefault: true},
		{UserID: userID, Name: "工作"},
		{UserID: userID, Name: "生活"},
	}
	if err := appDB.Create(&lists).Error; err != nil {
		t.Fatal(err)
	}
	for _, list := range lists {
		if err := appDB.Create(&Reminder{UserID: userID, ListID: list.ID, Title: list.Name, RepeatRule: "none"}).Error; err != nil {
			t.Fatal(err)
		}
	}

	var queryCount atomic.Int64
	if err := appDB.Callback().Query().Before("gorm:query").Register("test:list-count-query-count", func(*gorm.DB) {
		queryCount.Add(1)
	}); err != nil {
		t.Fatal(err)
	}
	if err := appDB.Callback().Row().Before("gorm:row").Register("test:list-count-row-query-count", func(*gorm.DB) {
		queryCount.Add(1)
	}); err != nil {
		t.Fatal(err)
	}

	// 「记事本」固定栏目在偏好开着但库里还没这一行时会补建一次（见 handleListLists）。
	// 那一次是**一次性**的（每个用户只建一条），不计入「稳态固定查询数」；
	// 先跑一次把栏目与偏好缓存都烘热，再清零计数，统计的才是后续请求的稳定态。
	warmRecorder := httptest.NewRecorder()
	warmCtx, _ := gin.CreateTestContext(warmRecorder)
	warmCtx.Request = httptest.NewRequest(http.MethodGet, "/api/reminder/lists", nil)
	warmCtx.Set("userID", uint(userID))
	handleListLists(appDB)(warmCtx)
	queryCount.Store(0)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/reminder/lists", nil)
	context.Set("userID", uint(userID))
	handleListLists(appDB)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	// 3 条固定查询：清单列表 + 未完成数聚合 + 卡片数聚合。
	// 关键是「固定」——再加多少清单也还是这几条（防的是 N+1，不是条数本身）。
	if got := queryCount.Load(); got != 4 {
		t.Fatalf("expected 4 fixed queries, got %d", got)
	}
}

func TestSummaryUsesTwoAggregateQueries(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 72
	now := time.Now()
	// 「已过期」那条要用**昨天**：0.20 起当天到期要等到「过期时间」（默认 23:59）才算逾期，
	// 用 now-1h 的话上午跑是逾期、下午跑就不是了（这个用例就红过）。
	past := now.AddDate(0, 0, -1)
	future := now.Add(time.Hour)
	completedAt := now
	rows := []Reminder{
		{UserID: userID, ListID: 1, Title: "已过期", DueAt: &past, RepeatRule: "none"},
		{UserID: userID, ListID: 1, Title: "待处理", DueAt: &future, RepeatRule: "none"},
		{UserID: userID, ListID: 1, Title: "已完成", DueAt: &past, CompletedAt: &completedAt, RepeatRule: "none"},
	}
	if err := appDB.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if err := appDB.Create(&Notification{UserID: userID, Type: "reminder_due", Title: "未读"}).Error; err != nil {
		t.Fatal(err)
	}

	var queryCount atomic.Int64
	if err := appDB.Callback().Query().Before("gorm:query").Register("test:summary-query-count", func(*gorm.DB) {
		queryCount.Add(1)
	}); err != nil {
		t.Fatal(err)
	}
	if err := appDB.Callback().Row().Before("gorm:row").Register("test:summary-row-query-count", func(*gorm.DB) {
		queryCount.Add(1)
	}); err != nil {
		t.Fatal(err)
	}

	// 「信用卡账单」开关（个人偏好）与「任务过期多久算逾期」（系统配置）都是进程内
	// 缓存的：刚启动时第一次读会各查一次配置，之后不再查。先把它们读热**再清零计数**，
	// 统计的才是稳定态（线上绝大多数请求都是）。
	creditCardFeatureEnabled(appDB, uint(userID))
	ceremonyFeatureEnabled(appDB, uint(userID))
	overdueGrace(appDB, uint(userID))
	queryCount.Store(0)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/reminder/summary", nil)
	context.Set("userID", uint(userID))
	handleSummary(appDB)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if got := queryCount.Load(); got != 2 {
		t.Fatalf("expected 2 aggregate queries, got %d", got)
	}
	var payload struct {
		Data map[string]int64 `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data["all"] != 2 || payload.Data["completed"] != 1 || payload.Data["overdue"] != 1 || payload.Data["unread"] != 1 {
		t.Fatalf("unexpected summary: %#v", payload.Data)
	}
}
