import type { InputParameters, SimulationResult } from './types'
import { runMonteCarloSimulation } from './simulation'

self.onmessage = (e: MessageEvent<{ params: InputParameters }>) => {
  const { params } = e.data

  const results = runMonteCarloSimulation(params, (progress) => {
    self.postMessage({ type: 'progress', progress })
  })

  self.postMessage({ type: 'complete', results })
}
