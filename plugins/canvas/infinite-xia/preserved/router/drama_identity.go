package router

import (
	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/handler"
	"github.com/tigerowo/infinite-canvas/service"
)

// RegisterDramaIdentityRoutes registers the source-backed identity CRUD routes.
// Keep :character aligned with the existing character and voice routes.
func RegisterDramaIdentityRoutes(v1 *gin.RouterGroup) {
	v1.POST("/drama/projects/:project/characters/build", func(c *gin.Context) {
		handler.DramaCharacterOperation(c.Writer, c.Request, c.Param("project"), "", "", service.DramaCharacterBuild)
	})
	v1.POST("/drama/projects/:project/characters/:character/portrait-async", func(c *gin.Context) {
		handler.DramaCharacterOperation(c.Writer, c.Request, c.Param("project"), c.Param("character"), "", service.DramaCharacterPortrait)
	})
	v1.POST("/drama/projects/:project/characters/:character/portrait/upload", func(c *gin.Context) {
		handler.DramaCharacterAssetUpload(c.Writer, c.Request, c.Param("project"), c.Param("character"), "", "", service.DramaCharacterPortraitUpload)
	})
	v1.GET("/drama/projects/:project/characters/:character/identities", func(c *gin.Context) {
		handler.DramaCharacterIdentities(c.Writer, c.Request, c.Param("project"), c.Param("character"))
	})
	v1.POST("/drama/projects/:project/characters/:character/identities", func(c *gin.Context) {
		handler.DramaCharacterIdentityCreate(c.Writer, c.Request, c.Param("project"), c.Param("character"))
	})
	v1.PATCH("/drama/projects/:project/characters/:character/identities/:identity", func(c *gin.Context) {
		handler.DramaCharacterIdentityUpdate(c.Writer, c.Request, c.Param("project"), c.Param("character"), c.Param("identity"))
	})
	v1.DELETE("/drama/projects/:project/characters/:character/identities/:identity", func(c *gin.Context) {
		handler.DramaCharacterIdentityDelete(c.Writer, c.Request, c.Param("project"), c.Param("character"), c.Param("identity"))
	})
	v1.GET("/drama/projects/:project/characters/:character/identities/:identity/attempts", func(c *gin.Context) {
		handler.DramaCharacterIdentityAttempts(c.Writer, c.Request, c.Param("project"), c.Param("character"), c.Param("identity"))
	})
	v1.POST("/drama/projects/:project/characters/:character/identities/:identity/generate-async", func(c *gin.Context) {
		handler.DramaCharacterOperation(c.Writer, c.Request, c.Param("project"), c.Param("character"), c.Param("identity"), service.DramaIdentityImage)
	})
	v1.POST("/drama/projects/:project/characters/:character/identities/:identity/portrait/generate-async", func(c *gin.Context) {
		handler.DramaCharacterOperation(c.Writer, c.Request, c.Param("project"), c.Param("character"), c.Param("identity"), service.DramaIdentityPortrait)
	})
	v1.POST("/drama/projects/:project/characters/:character/identities/by-name/:identityName/upload", func(c *gin.Context) {
		handler.DramaCharacterAssetUpload(c.Writer, c.Request, c.Param("project"), c.Param("character"), "", c.Param("identityName"), service.DramaIdentityImageUpload)
	})
	v1.POST("/drama/projects/:project/characters/:character/identities/:identity/costume/upload", func(c *gin.Context) {
		handler.DramaCharacterAssetUpload(c.Writer, c.Request, c.Param("project"), c.Param("character"), c.Param("identity"), "", service.DramaIdentityCostumeUpload)
	})
	v1.POST("/drama/projects/:project/characters/:character/identities/:identity/costume/delete", func(c *gin.Context) {
		handler.DramaCharacterIdentityAssetDelete(c.Writer, c.Request, c.Param("project"), c.Param("character"), c.Param("identity"), service.DramaIdentityCostumeDelete)
	})
	v1.POST("/drama/projects/:project/characters/:character/identities/:identity/portrait/upload", func(c *gin.Context) {
		handler.DramaCharacterAssetUpload(c.Writer, c.Request, c.Param("project"), c.Param("character"), c.Param("identity"), "", service.DramaIdentityPortraitUpload)
	})
	v1.POST("/drama/projects/:project/characters/:character/identities/:identity/image/delete", func(c *gin.Context) {
		handler.DramaCharacterIdentityAssetDelete(c.Writer, c.Request, c.Param("project"), c.Param("character"), c.Param("identity"), service.DramaIdentityImageDelete)
	})
}
