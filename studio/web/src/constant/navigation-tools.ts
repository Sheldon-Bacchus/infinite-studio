import { Clapperboard, FileText, Film, ImagePlus, Images, Settings2, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        path: "/sudio",
        icon: Clapperboard,
    },
    {
        slug: "works",
        path: "/works",
        icon: Film,
    },
    {
        slug: "image",
        path: "/image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        path: "/video",
        icon: Video,
    },
    {
        slug: "prompts",
        path: "/prompts",
        icon: FileText,
    },
    {
        slug: "assets",
        path: "/assets",
        icon: Images,
    },
    {
        slug: "config",
        path: "/config",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
