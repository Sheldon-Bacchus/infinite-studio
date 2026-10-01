package router

import (
	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/handler"
)

// RegisterDramaPropReferenceRoutes mounts DramaClaw's source generation task
// and its exact task-state lookup onto an authenticated v1 group.
func RegisterDramaPropReferenceRoutes(v1 *gin.RouterGroup) {
	v1.POST("/drama/projects/:project/props/:name/reference/generate-async", func(c *gin.Context) {
		handler.DramaPropReferenceGenerateAsync(c.Writer, c.Request, c.Param("project"), c.Param("name"))
	})
	v1.GET("/drama/projects/:project/props/:name/reference/task", func(c *gin.Context) {
		handler.DramaPropReferenceTask(c.Writer, c.Request, c.Param("project"), c.Param("name"))
	})
}
