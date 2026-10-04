import { serverlessHandler } from '../_runtime.js'

export const config = { api: { bodyParser: false } }

export default serverlessHandler()
