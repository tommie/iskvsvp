import type { InputParameters } from './types'
import { simulateAll } from './simulation'

self.onmessage = (e: MessageEvent<{ paramSets: InputParameters[]; labels: string[] }>) => {
  try {
    const { paramSets, labels } = e.data

    const results = simulateAll(paramSets, labels, (progress) => {
      self.postMessage({ type: 'progress', progress })
    })

    self.postMessage({ type: 'complete', results })
  } catch (error) {
    console.error('Worker error:', error)
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace')
    self.postMessage({
      type: 'error',
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    })
  }
}
