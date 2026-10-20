package assistant

import (
	"context"
	"math"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"smallgo/server/logger"
	"smallgo/server/response"
)

// 本机 Ollama 的默认端口。只探这一个口：管理端是管理员用的，但也没必要变成一个
// 任意端口扫描器。
const ollamaPort = "11434"

// 单条候选地址的等待上限。探测要「点一下就有结果」，宁可漏掉慢的，也不让面板
// 一直转圈。
const ollamaProbeTimeout = 2500 * time.Millisecond

// 一次探测的总预算：候选最多 5 条，留一点余量。
const ollamaDetectBudget = 12 * time.Second

// ollamaCandidate 是一条候选地址。
type ollamaCandidate struct {
	BaseURL string `json:"base_url"`
	Label   string `json:"label"`
}

// ollamaAttempt 是一条候选地址的探测结果。失败原因也带回去：面板上要能看到
// 「试过哪些地址、各自为什么不行」，否则用户只能干猜。
type ollamaAttempt struct {
	BaseURL string   `json:"base_url"`
	Label   string   `json:"label"`
	OK      bool     `json:"ok"`
	Detail  string   `json:"detail,omitempty"`
	Models  []string `json:"models,omitempty"`
}

// ollamaDetection 是「检测本机 Ollama」的结果。
type ollamaDetection struct {
	Found    bool            `json:"found"`
	BaseURL  string          `json:"base_url,omitempty"`
	Label    string          `json:"label,omitempty"`
	Models   []string        `json:"models,omitempty"`
	Attempts []ollamaAttempt `json:"attempts"`
}

// ollamaCandidates 排探测顺序。
//
// 为什么需要探测：后端跑在容器里时 127.0.0.1 是容器自己，而 Ollama 装在同一台
// 机器的宿主上；容器里看不到宿主的局域网地址，但管理员访问本服务用的那个地址
// （请求的 Host）通常正是它，所以排在第二位（第一位留给已经填过的地址）。
func ollamaCandidates(r *http.Request, saved string) []ollamaCandidate {
	out := make([]ollamaCandidate, 0, 5)
	if saved = strings.TrimSpace(saved); saved != "" {
		if normalized, err := normalizeBaseURL(saved); err == nil && normalized != "" {
			out = append(out, ollamaCandidate{BaseURL: normalized, Label: "当前填写的地址"})
		}
	}
	if host := requestHostOnly(r); host != "" {
		out = append(out, ollamaCandidate{
			BaseURL: "http://" + net.JoinHostPort(host, ollamaPort) + "/v1",
			Label:   "你访问本服务的地址（宿主局域网 IP）",
		})
	}
	return dedupeOllamaCandidates(append(out,
		ollamaCandidate{BaseURL: "http://127.0.0.1:" + ollamaPort + "/v1", Label: "本机直连（后端与 Ollama 同机）"},
		ollamaCandidate{BaseURL: "http://172.17.0.1:" + ollamaPort + "/v1", Label: "Docker 网桥网关（Linux）"},
		ollamaCandidate{BaseURL: "http://host.docker.internal:" + ollamaPort + "/v1", Label: "Docker Desktop（Mac / Windows）"},
	))
}

// requestHostOnly 取请求 Host 里的主机名，并把「等于本机」的值滤掉——那是无意义
// 的重复候选（127.0.0.1 那条本来就在列表里）。
func requestHostOnly(r *http.Request) string {
	if r == nil {
		return ""
	}
	host := strings.TrimSpace(r.Host)
	if host == "" {
		return ""
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	switch strings.ToLower(host) {
	case "", "localhost", "127.0.0.1", "::1", "host.docker.internal":
		return ""
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return ""
	}
	return host
}

func dedupeOllamaCandidates(in []ollamaCandidate) []ollamaCandidate {
	seen := make(map[string]bool, len(in))
	out := make([]ollamaCandidate, 0, len(in))
	for _, item := range in {
		item.BaseURL = strings.TrimSpace(item.BaseURL)
		if item.BaseURL == "" {
			continue
		}
		key := strings.ToLower(strings.TrimSuffix(item.BaseURL, "/"))
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

// detectOllama 依次探测候选地址，第一个能列出模型的就算命中。
//
// 用「列模型」而不是「拉 /api/version」当判据：能列出模型说明端口、路径、协议
// 都对得上，接下来面板还要把这些模型名填进候选框，正好一次拿到。
func detectOllama(ctx context.Context, candidates []ollamaCandidate) ollamaDetection {
	result := ollamaDetection{Attempts: make([]ollamaAttempt, 0, len(candidates))}
	for _, candidate := range candidates {
		attempt := ollamaAttempt{BaseURL: candidate.BaseURL, Label: candidate.Label}
		probeCtx, cancel := context.WithTimeout(ctx, ollamaProbeTimeout)
		models, err := listOllamaModels(probeCtx, candidate.BaseURL)
		cancel()
		if err != nil {
			attempt.Detail = err.Error()
			result.Attempts = append(result.Attempts, attempt)
			continue
		}
		attempt.OK = true
		attempt.Models = models
		result.Attempts = append(result.Attempts, attempt)
		result.Found = true
		result.BaseURL = candidate.BaseURL
		result.Label = candidate.Label
		result.Models = models
		break
	}
	return result
}

// listOllamaModels 复用对话客户端去列模型：连不上会给出和「测试连接」同一套中文
// 说明，面板不用两套话术。
func listOllamaModels(ctx context.Context, baseURL string) ([]string, error) {
	c := newClient(Settings{
		Provider: "ollama",
		BaseURL:  baseURL,
		// 客户端超时是整秒，向上取整：直接截断会变成 2s，比这里的探测预算还短，
		// 探测就成了「2 秒必断」，慢一点的机器永远报连不上。
		TimeoutSeconds: int(math.Ceil(ollamaProbeTimeout.Seconds())),
	})
	return c.ListModels(ctx)
}

// handleDetectOllama 给「本机 Ollama 一键接入」用：管理员点一下，服务端把候选地址
// 试一遍，把第一个能用的地址和它上面的模型列表带回去。
func handleDetectOllama(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		saved := loadSettings(db).BaseURL
		ctx, cancel := context.WithTimeout(c.Request.Context(), ollamaDetectBudget)
		defer cancel()
		candidates := ollamaCandidates(c.Request, saved)
		result := detectOllama(ctx, candidates)
		if result.Found {
			logger.Info("AI 助手：本机 Ollama 探测命中 %s（模型 %d 个）", result.BaseURL, len(result.Models))
		} else {
			logger.Info("AI 助手：本机 Ollama 探测未命中，试过 %d 个地址", len(result.Attempts))
		}
		response.Success(c, result)
	}
}
