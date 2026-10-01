package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/config"
)

func TestRegisterDramaTaskRoutesUsesAuthenticatedV1Group(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previous := config.Cfg
	config.Cfg = config.Config{DramaClawBaseURL: "http://127.0.0.1:1", DramaClawAPIToken: "server-token"}
	t.Cleanup(func() { config.Cfg = previous })

	engine := gin.New()
	auth := func(c *gin.Context) {
		if c.GetHeader("Authorization") != "Bearer user-token" {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		c.Next()
	}
	v1 := engine.Group("/api/v1", auth)
	RegisterDramaTaskRoutes(v1)

	want := map[string]bool{
		"GET /api/v1/drama/projects/:project/tasks":                        false,
		"GET /api/v1/drama/projects/:project/tasks/limits":                 false,
		"GET /api/v1/drama/projects/:project/tasks/:task_type/:episode":    false,
		"GET /api/v1/drama/projects/:project/tasks/stream":                 false,
		"DELETE /api/v1/drama/projects/:project/tasks/:task_type/:episode": false,
	}
	for _, route := range engine.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := want[key]; ok {
			want[key] = true
		}
	}
	for route, registered := range want {
		if !registered {
			t.Errorf("required source task route not registered: %s", route)
		}
	}

	unauthorized := httptest.NewRecorder()
	engine.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/api/v1/drama/projects/demo/tasks", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized response status=%d", unauthorized.Code)
	}
}
