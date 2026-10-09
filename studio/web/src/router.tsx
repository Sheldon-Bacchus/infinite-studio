import { createBrowserRouter, Outlet, useLocation } from "react-router-dom";
import { Navigate, useParams } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";
import WorksPage from "@/pages/works";
import WorksMigrationPage from "@/pages/works/migration";

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/works", element: <WorksPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/sudio", element: <CanvasPage /> },
            { path: "/sudio/:id", element: <CanvasProjectPage /> },
            { path: "/canvas", element: <LegacyCanvasRedirect /> },
            { path: "/canvas/:id", element: <LegacyCanvasRedirect /> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/works/migration", element: <WorksMigrationPage /> },
            { path: "/works/:workId/migration", element: <WorksMigrationPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);

// 旧 /canvas 路由只做跳转，保留既有用户标签、查询参数与 Agent 引导 hash。
function LegacyCanvasRedirect() {
    const location = useLocation();
    const params = useParams<{ id?: string }>();
    const target = params.id ? `/sudio/${params.id}` : "/sudio";
    return <Navigate to={`${target}${location.search}${location.hash}`} replace />;
}
