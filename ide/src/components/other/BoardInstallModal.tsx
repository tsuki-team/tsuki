'use client'
import type { BoardPlatform } from '@/lib/store'
export default function BoardInstallModal(_: {
  platform: BoardPlatform
  onClose: () => void
  onInstalled: (p: BoardPlatform) => void
}) { return null }
