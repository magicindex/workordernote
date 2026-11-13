package reminder

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// 分期还款计划（用户 2026-11-13）：
//
//	· 卡面「第几期」只有**分期卡**才显示，已还清（paid == periods）不再显示；
//	· 允许手工改每期费率（0 = 用官方默认费率）；
//	· 校验：期数 0–60、已还 ≤ 总期数、费率 0–50%。
func TestCardInstallmentPlan(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cleanup := testDB(t)
	defer cleanup()

	const userID = 96
	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	card := Card{UserID: userID, ListID: list.ID, Name: "经典白", Bank: "招商银行", StatementDay: 5, DueDay: 25}
	if err := appDB.Create(&card).Error; err != nil {
		t.Fatal(err)
	}

	patch := func(body string) *httptest.ResponseRecorder {
		r := gin.New()
		r.PATCH("/cards/:id", func(c *gin.Context) {
			c.Set("userID", userID)
			handleUpdateCard(appDB)(c)
		})
		req := httptest.NewRequest(http.MethodPatch, "/cards/"+itoa(card.ID), strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	// 没分期：期数为 0
	var fresh Card
	if err := appDB.First(&fresh, card.ID).Error; err != nil {
		t.Fatal(err)
	}
	if fresh.InstallmentPeriods != 0 || fresh.InstallmentPaid != 0 || fresh.InstallmentRate != 0 {
		t.Fatalf("新卡不应带分期计划：%+v", fresh)
	}

	// 设成 12 期、已还 3 期、本金 12000 元、手工费率 0.62%
	if w := patch(`{"installment_periods":12,"installment_paid":3,"installment_principal_cents":1200000,"installment_rate":0.62}`); w.Code != http.StatusOK {
		t.Fatalf("设置分期应成功，实际 %d %s", w.Code, w.Body.String())
	}
	var withPlan Card
	if err := appDB.First(&withPlan, card.ID).Error; err != nil {
		t.Fatal(err)
	}
	if withPlan.InstallmentPeriods != 12 || withPlan.InstallmentPaid != 3 ||
		withPlan.InstallmentPrincipal != 1200000 || withPlan.InstallmentRate != 0.62 {
		t.Fatalf("分期计划没存对：%+v", withPlan)
	}

	// 已还清：paid == periods（卡面按「paid >= periods」判定不显示期数）
	if w := patch(`{"installment_paid":12}`); w.Code != http.StatusOK {
		t.Fatalf("改成已还清应成功，实际 %d %s", w.Code, w.Body.String())
	}
	var done Card
	appDB.First(&done, card.ID)
	if done.InstallmentPaid != 12 || done.InstallmentPeriods != 12 {
		t.Fatalf("已还清状态不对：%+v", done)
	}

	// 已还期数超过总期数：400
	if w := patch(`{"installment_paid":13}`); w.Code != http.StatusBadRequest {
		t.Fatalf("超过总期数应 400，实际 %d", w.Code)
	}
	// 期数越界：400
	if w := patch(`{"installment_periods":61}`); w.Code != http.StatusBadRequest {
		t.Fatalf("期数越界应 400，实际 %d", w.Code)
	}
	// 费率越界：400
	if w := patch(`{"installment_rate":60}`); w.Code != http.StatusBadRequest {
		t.Fatalf("费率越界应 400，实际 %d", w.Code)
	}

	// 取消分期（期数 0）：已还/本金/费率清空
	if w := patch(`{"installment_periods":0}`); w.Code != http.StatusOK {
		t.Fatalf("取消分期应成功，实际 %d %s", w.Code, w.Body.String())
	}
	var cleared Card
	appDB.First(&cleared, card.ID)
	if cleared.InstallmentPeriods != 0 || cleared.InstallmentPaid != 0 ||
		cleared.InstallmentPrincipal != 0 || cleared.InstallmentRate != 0 {
		t.Fatalf("取消分期后应全部清零：%+v", cleared)
	}
}

// 分期计划随卡片同步：对端也要能看到「第几期」。
func TestCardInstallmentPlanSyncs(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	userA := seedUser(t, appDB, "王耀辉", "admin")
	list, err := ensureDefaultList(appDB, userA.ID)
	if err != nil {
		t.Fatal(err)
	}
	card := Card{
		UserID: userA.ID, ListID: list.ID, Name: "分期卡", Bank: "招商银行",
		StatementDay: 5, DueDay: 25, InstallmentPeriods: 12, InstallmentPaid: 4,
		InstallmentPrincipal: 600000, InstallmentRate: 0.66,
	}
	if err := appDB.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	snap, err := buildSyncSnapshot(appDB)
	if err != nil {
		t.Fatal(err)
	}
	// 同一份快照应用到本库另一张同名卡？这里只验证快照里带上了分期字段
	if len(snap.Cards) != 1 {
		t.Fatalf("应有 1 张卡，实际 %d", len(snap.Cards))
	}
	got := snap.Cards[0]
	if got.InstallmentPeriods != 12 || got.InstallmentPaid != 4 ||
		got.InstallmentPrincipal != 600000 || got.InstallmentRate != 0.66 {
		t.Fatalf("快照未带分期计划：%+v", got)
	}
}
