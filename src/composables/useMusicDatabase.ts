import { computed, ref } from 'vue'
import type { MusicDatabase, StyleDatabase } from '@/models/music'
import { loadMusicDatabase, loadStyleDatabase } from '@/services/database'
import { computeTrackStats } from '@/utils/stats'

export function useMusicDatabase() {
  const database = ref<MusicDatabase | null>(null)
  const styleDatabase = ref<StyleDatabase | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function load(force = false): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [music, styles] = await Promise.all([
        loadMusicDatabase(force),
        loadStyleDatabase(force),
      ])
      database.value = music
      styleDatabase.value = styles
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to load the database'
    } finally {
      loading.value = false
    }
  }

  void load()

  const tracks = computed(() => database.value?.tracks ?? [])
  const styles = computed(() => styleDatabase.value?.styles ?? [])
  const stats = computed(() => computeTrackStats(tracks.value, styles.value.length))

  return {
    database,
    styleDatabase,
    tracks,
    styles,
    stats,
    loading,
    error,
    reload: () => load(true),
  }
}
