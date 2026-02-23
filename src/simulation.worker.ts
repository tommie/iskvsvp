import type { InputParameters } from './types'
import type { BootstrapPayload } from './bootstrap'
import type { FactorModelPayload } from './factor-model'
import { simulateAll } from './simulation'

self.onmessage = (
  e: MessageEvent<{
    paramSets: InputParameters[]
    labels: string[]
    bootstrapPayload?: BootstrapPayload
    factorModelPayload?: FactorModelPayload
  }>,
) => {
  try {
    const { paramSets, labels, bootstrapPayload, factorModelPayload } = e.data

    const results = simulateAll(
      paramSets,
      labels,
      (progress) => {
        self.postMessage({ type: 'progress', progress })
      },
      bootstrapPayload,
      factorModelPayload,
    )

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
