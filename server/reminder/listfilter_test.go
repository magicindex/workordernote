package reminder

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseListFilter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		query string
		want  []uint
	}{
		{"", nil},
		{"list_id=3", []uint{3}},
		{"list_ids=1,2,3", []uint{1, 2, 3}},
		{"list_ids=2,2,2", []uint{2}},            // 去重
		{"list_ids=1,abc,3", []uint{1, 3}},       // 跳过非法项
		{"list_ids=,0,-1,", nil},                 // 全非法 → 不筛选
		{"list_ids=1,2&list_id=9", []uint{1, 2}}, // list_ids 优先
	}
	for _, tc := range cases {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/x?"+tc.query, nil)
		got := parseListFilter(c)
		if len(got) != len(tc.want) {
			t.Fatalf("%q => %v, want %v", tc.query, got, tc.want)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("%q => %v, want %v", tc.query, got, tc.want)
			}
		}
	}
}
