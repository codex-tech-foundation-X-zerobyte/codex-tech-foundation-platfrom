import { BarChart3, Clapperboard, Globe, Presentation, Terminal, type LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { StageKind } from '../../lib/presentation'
import { BrowserStage } from './stages/BrowserStage'
import { CinemaStage } from './stages/CinemaStage'
import { ConsoleStage } from './stages/ConsoleStage'
import { DashboardStage } from './stages/DashboardStage'
import { SlidesStage } from './stages/SlidesStage'
import type { StageProps } from './stages/types'

export const STAGE_ICON: Record<StageKind, LucideIcon> = { browser: Globe, console: Terminal, dashboard: BarChart3, cinema: Clapperboard, slides: Presentation }
export const STAGE_COMPONENT: Record<StageKind, ComponentType<StageProps>> = { browser: BrowserStage, console: ConsoleStage, dashboard: DashboardStage, cinema: CinemaStage, slides: SlidesStage }
