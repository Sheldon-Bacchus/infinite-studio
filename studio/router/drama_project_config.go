package router

import (
	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/handler"
)

// RegisterDramaProjectConfigRoutes attaches read and partial-update routes for
// a source-owned DramaClaw project config. The caller supplies the /api/v1
// group so authentication remains owned by the main router.
func RegisterDramaProjectConfigRoutes(v1 *gin.RouterGroup) {
	v1.GET("/drama/projects/:project", func(c *gin.Context) {
		handler.DramaProjectConfigGet(c.Writer, c.Request, c.Param("project"))
	})
	v1.PATCH("/drama/projects/:project", func(c *gin.Context) {
		handler.DramaProjectConfigPatch(c.Writer, c.Request, c.Param("project"))
	})
}
