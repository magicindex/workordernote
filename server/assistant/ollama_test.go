package assistant

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// newModelsStub 起一个只实现 /v1/models 的桩服务，模拟本机 Ollama。
func newModelsStub(t *testing.T, models ...string) *httptest.Server {
	t.Helper()
	return newStubUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		// 候选地址自带 /v1，所以只认路径尾巴，不要求正好是 /models。
		if !strings.HasSuffix(r.URL.Path, "/models") {
			http.NotFound(w, r)
			return
		}
		items := make([]map[string]string, 0, len(models))
		for _, name := range models {
			items = append(items, map[string]string{"id": name})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": items})
	})
}

// closedBaseURL 返回一个「确定连不上」的地址：起一个服务立刻关掉，端口就空出来了。
func closedBaseURL(t *testing.T) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := server.URL
	server.Close()
	return url
}

// TestOllamaCandidatesPreferSavedAndDedupe 锁住候选顺序：
// 已经填过的地址排第一（先确认「现在这套还能不能用」），管理员访问本服务用的
// 地址排第二（容器里它就是宿主地址），随后才是几个常见的容器内地址；重复的去掉。
func TestOllamaCandidatesPreferSavedAndDedupe(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/assistant/admin/detect-ollama", nil)
	request.Host = "192.168.1.10:8906"

	candidates := ollamaCandidates(request, "http://192.168.1.10:11434/v1")

	// 「已填地址」和「Host 推出来的地址」是同一条：只能留一个。
	if len(candidates) != 4 {
		t.Fatalf("去重后应当是 4 条候选，实际 %d 条：%+v", len(candidates), candidates)
	}
	if candidates[0].Label != "当前填写的地址" {
		t.Errorf("第一条应当是已填写的地址，实际是 %q", candidates[0].Label)
	}
	if candidates[0].BaseURL != "http://192.168.1.10:11434/v1" {
		t.Errorf("第一条地址不对：%q", candidates[0].BaseURL)
	}
	for _, item := range candidates {
		if item.BaseURL == "" || item.Label == "" {
			t.Errorf("每条候选都要有地址和说明：%+v", item)
		}
	}
	if !hasCandidate(candidates, "http://127.0.0.1:11434/v1") {
		t.Errorf("少了本机直连这条候选：%+v", candidates)
	}
}

// TestOllamaCandidatesFromRequestHost 是「容器里能用本机 Ollama」的关键：
// 请求 Host 上的主机名 + 11434 + /v1 就是宿主地址那条候选。
func TestOllamaCandidatesFromRequestHost(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/assistant/admin/detect-ollama", nil)
	request.Host = "192.168.10.253:8906"

	candidates := ollamaCandidates(request, "")
	if candidates[0].BaseURL != "http://192.168.10.253:11434/v1" {
		t.Fatalf("第一条应当由请求 Host 推导出来，实际 %q", candidates[0].BaseURL)
	}
	if !strings.Contains(candidates[0].Label, "你访问本服务的地址") {
		t.Errorf("说明要写清楚这条是怎么来的，实际 %q", candidates[0].Label)
	}
}

// TestOllamaCandidatesSkipLoopbackRequestHost 反向用例：从 127.0.0.1 打开管理端
// 时，Host 推出来的地址没有意义（列表里本来就有本机直连），不应当塞进来。
func TestOllamaCandidatesSkipLoopbackRequestHost(t *testing.T) {
	for _, host := range []string{"127.0.0.1:8906", "localhost:8906", "localhost"} {
		request := httptest.NewRequest(http.MethodPost, "/api/assistant/admin/detect-ollama", nil)
		request.Host = host
		candidates := ollamaCandidates(request, "")
		if len(candidates) != 3 {
			t.Fatalf("Host=%q 时应当是 3 条候选，实际 %d 条：%+v", host, len(candidates), candidates)
		}
		for _, item := range candidates {
			if strings.Contains(item.Label, "你访问本服务的地址") {
				t.Errorf("Host=%q 不应当推出宿主地址候选：%+v", host, item)
			}
		}
	}
}

// TestDetectOllamaPicksFirstReachable 命中第一条能用上的，就不再往下试；
// 失败的那条要把原因带回去（面板要显示「试过哪些、各自为什么不行」）。
func TestDetectOllamaPicksFirstReachable(t *testing.T) {
	dead := closedBaseURL(t)
	live := newModelsStub(t, "qwen2.5:7b", "nomic-embed-text")
	never := closedBaseURL(t)

	detection := detectOllama(context.Background(), []ollamaCandidate{
		{BaseURL: dead, Label: "连不上的那条"},
		{BaseURL: live.URL + "/v1", Label: "本机直连"},
		{BaseURL: never, Label: "本来不该被探到"},
	})

	if !detection.Found {
		t.Fatalf("第二条能列模型，应当命中：%+v", detection)
	}
	if detection.BaseURL != live.URL+"/v1" || detection.Label != "本机直连" {
		t.Errorf("命中的不是第二条：%+v", detection)
	}
	if len(detection.Models) != 2 {
		t.Errorf("应当把模型列表一起带回来，实际 %+v", detection.Models)
	}
	if len(detection.Attempts) != 2 {
		t.Errorf("命中之后不应当继续探测，实际探了 %d 条", len(detection.Attempts))
	}
	if detection.Attempts[0].OK || detection.Attempts[0].Detail == "" {
		t.Errorf("失败的那条要留下原因：%+v", detection.Attempts[0])
	}
}

// TestDetectOllamaReportsEveryFailure 一条都不通时，要逐条给出原因——
// 这是用户唯一能照着排查的线索。
func TestDetectOllamaReportsEveryFailure(t *testing.T) {
	first, second := closedBaseURL(t), closedBaseURL(t)
	detection := detectOllama(context.Background(), []ollamaCandidate{
		{BaseURL: first, Label: "甲"},
		{BaseURL: second, Label: "乙"},
	})

	if detection.Found || detection.BaseURL != "" {
		t.Fatalf("都不通时不应当报命中：%+v", detection)
	}
	if len(detection.Attempts) != 2 {
		t.Fatalf("两条候选都要有尝试记录，实际 %d 条", len(detection.Attempts))
	}
	for _, attempt := range detection.Attempts {
		if attempt.OK {
			t.Errorf("%s 不应当被标记为成功", attempt.BaseURL)
		}
		if attempt.Detail == "" {
			t.Errorf("%s 没给出失败原因", attempt.BaseURL)
		}
	}
}

// TestDetectOllamaHandlerAlwaysReturnsEnvelope 走一遍 HTTP 处理函数：
// 无论找没找到，都要是 {code:0} 的信封，并且把候选的尝试记录带回去。
//
// 用「已保存的地址指着一个关掉的端口」来定住第一次探测，这样断言不受测试机
// 上到底有没有 Ollama 影响。
func TestDetectOllamaHandlerAlwaysReturnsEnvelope(t *testing.T) {
	db := newTestDB(t)
	dead := closedBaseURL(t)
	saveComplete(t, db, dead, settingsInput{Provider: "ollama", APIKey: "sk-x"})

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/assistant/admin/detect-ollama", nil)
	ctx.Request.Host = "192.168.1.10:8906"

	handleDetectOllama(db)(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("HTTP 状态码应当是 200，实际 %d", recorder.Code)
	}
	var parsed struct {
		Code int             `json:"code"`
		Data ollamaDetection `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("响应不是合法 JSON：%v（%s）", err, recorder.Body.String())
	}
	if parsed.Code != 0 {
		t.Fatalf("信封 code 应当是 0，实际 %d（%s）", parsed.Code, recorder.Body.String())
	}
	if len(parsed.Data.Attempts) == 0 {
		t.Fatal("应当把候选的尝试记录带回来")
	}
	first := parsed.Data.Attempts[0]
	if first.BaseURL != dead {
		t.Errorf("第一条应当先探已保存的地址 %s，实际 %s", dead, first.BaseURL)
	}
	if first.OK || first.Detail == "" {
		t.Errorf("关掉的端口不应当成功，而且要给出原因：%+v", first)
	}
}

// hasCandidate 判断候选里有没有这条地址。
func hasCandidate(candidates []ollamaCandidate, baseURL string) bool {
	for _, item := range candidates {
		if item.BaseURL == baseURL {
			return true
		}
	}
	return false
}
