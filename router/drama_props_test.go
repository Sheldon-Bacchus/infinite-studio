package router_test

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/router"
)

func TestRegisterDramaPropReferenceRoutesOnlyAddsSourceTaskEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	router.RegisterDramaPropReferenceRoutes(engine.Group("/api/v1"))

	registered := map[string]bool{}
	for _, route := range engine.Routes() {
		registered[route.Method+" "+route.Path] = true
	}
	for _, expected := range []string{
		"POST /api/v1/drama/projects/:project/props/:name/reference/generate-async",
		"GET /api/v1/drama/projects/:project/props/:name/reference/task",
	} {
		if !registered[expected] {
			t.Errorf("missing route %q; registered=%v", expected, registered)
		}
	}
	if len(registered) != 2 {
		t.Fatalf("unexpected helper route set: %v", registered)
	}
}
