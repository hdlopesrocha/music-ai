import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import AnalyzeView from '@/views/AnalyzeView.vue'
import DatabaseView from '@/views/DatabaseView.vue'
import StylesView from '@/views/StylesView.vue'
import ResultView from '@/views/ResultView.vue'
import NotFoundView from '@/views/NotFoundView.vue'

export const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/analyze', name: 'analyze', component: AnalyzeView },
    { path: '/database', name: 'database', component: DatabaseView },
    { path: '/styles', name: 'styles', component: StylesView },
    { path: '/result', name: 'result', component: ResultView },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})
