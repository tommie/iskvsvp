<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'

import { usePlannerStore } from '../../stores/planner'
import { formatKr, formatKrExact, formatPercent } from '../../planner/format'

const store = usePlannerStore()
const { results, cashflow, startAge } = storeToRefs(store)

/**
 * One spreadsheet column: what it is called, what it computes, and the prose
 * that says why.
 *
 * The formula is kept as a string beside the function that evaluates it rather
 * than being derived from it, so it can be written the way the model is
 * described — with subscripts and the same names `propagate.ts` uses — instead
 * of the way TypeScript happens to spell it.
 */
interface Column {
  label: string
  formula: string
  note: string
  /** Rendered cell text for the year at index `t`. */
  cell: (t: number) => string
  /** Inputs are echoed back as entered; everything computed is a figure. */
  input?: boolean
}

const columns = computed<Column[]>(() => {
  const r = results.value
  if (!r) return []
  const run = r.adaptiveRun
  const flow = cashflow.value
  const schedule = r.schedule

  return [
    {
      label: 'Ålder',
      formula: 'startålder + t',
      note: 'Bara en etikett. Planen räknar i år, inte i kalenderår.',
      cell: (t) => String(startAge.value + t),
      input: true,
    },
    {
      label: 'År',
      formula: 't',
      note: 'Året i planen. År 0 är det första året du tar ut pengar, efter ett års avkastning.',
      cell: (t) => String(t),
      input: true,
    },
    {
      label: 'Behov',
      formula: 'behov[t]',
      note: 'Som du angett det i kassaflödet. Negativt är en insättning. Det som inte går att betala är vad planeraren kallar att planen spricker.',
      cell: (t) => formatKrExact(flow[t]!.need),
      input: true,
    },
    {
      label: 'Extra',
      formula: 'extra[t]',
      note: 'Taket för det frivilliga uttaget, som du angett det. Den dynamiska körningen tar det bara i den mån överskottet räcker, och aldrig mer än så här.',
      cell: (t) => formatKrExact(Math.max(0, flow[t]!.extra)),
      input: true,
    },
    {
      label: 'Reserv',
      formula: 'Σ behov[s] · (1 + r(s−t))^−(s−t),  s ≥ t',
      note: `Nuvärdet av alla behovsuttag som återstår. Varje åtagande diskonteras med räntan för sitt eget avstånd, inte för hela tidsperioden — r är 25:e percentilen av avkastningen, netto efter schablonskatt, och vid hela tidsperioden ${formatPercent(r.reserveReturn * 100)}. Ett åtagande närmare i tiden diskonteras lägre än så.`,
      cell: (t) => formatKr(schedule.reserve[t]!),
    },
    {
      label: 'Arvsreserv',
      formula: 'arvsmål · (1 + m)^−(antal år − 1 − t)',
      note: `Arvsmålet diskonterat till år t. Här är m medianavkastningen netto efter skatt, ${formatPercent(r.bequestReturn * 100)}, och inte behovets percentil: att missa arvet är inte att planen spricker, så det prissätts inte som ett golv. Noll om planen inte har något arvsmål.`,
      cell: (t) => formatKr(schedule.keep[t]!),
    },
    {
      label: 'Annuitetsfaktor',
      formula: '(Σ extra[s] · (1 + r(s−t))^−(s−t)) / extra[t],  s ≥ t',
      note: 'Hur mycket överskott en krona av årets extra kostar. Överskottet fördelas över det extra som återstår i den form du ritat den, så ett år som begär dubbelt så mycket som sina grannar betjänas dubbelt så fort. Faktorn faller mot 1 i sista året, då hela överskottet går ut.',
      cell: (t) => (schedule.annuity[t]! >= 1000 ? '—' : schedule.annuity[t]!.toFixed(1)),
    },
    {
      label: 'Uttag, median',
      formula: 'behov[t] + min(extra[t], (kapital − reserv − arvsreserv) / annuitetsfaktor)',
      note: 'Vad den dynamiska körningen betalar ut, medianen över alla utfall. Ovillkorad: ett år som en redan sprucken plan aldrig nådde räknas som noll, inte som bortfall.',
      cell: (t) => formatKr(run.withdrawals[t]!.median),
    },
    {
      label: 'Uttag, medel',
      formula: 'Σ sannolikhet · uttag',
      note: 'Samma uttag, sannolikhetsvägt. Summan av den här kolumnen är exakt det förväntade totala uttaget i tabellen ovan — inte en annan skattning av det.',
      cell: (t) => formatKr(run.withdrawals[t]!.mean),
    },
    {
      label: 'Kapital, median',
      formula: 'medianen av fördelningen efter årets avkastning, uttag och skatt',
      note: 'Fördelningens median vid årets slut, före eventuell uppskjuten skatt. Percentiler är marginaler av fördelningen, inte en bana: den här raden går inte att räkna fram ur raden ovanför, och kolumnen är inte ett utfall någon enskild plan följer.',
      cell: (t) => formatKr(run.outcomes[t + 1]!.median),
    },
    {
      label: 'Risk att planen spruckit',
      formula: 'P(något behovsuttag har misslyckats till och med år t)',
      note: 'Kumulativ och absorberande: en plan som en gång inte kunnat betala hela behovsuttaget kommer aldrig tillbaka, och en senare insättning räddar den inte.',
      cell: (t) => formatPercent(run.outcomes[t + 1]!.ruinProbability * 100),
    },
  ]
})

const years = computed(() => cashflow.value.length)

/**
 * The column the pointer is on, shown in a formula bar above the table.
 *
 * A bar rather than a floating tooltip because the table scrolls sideways on a
 * narrow screen, and anything absolutely positioned inside that container is
 * clipped by it. A spreadsheet puts the formula in a bar anyway, which is the
 * thing this card is imitating. The same text rides along in `title` so it is
 * reachable by touch and by assistive technology, neither of which has a
 * pointer to hover with.
 */
const active = ref<Column | null>(null)

function describe(column: Column): string {
  return `${column.formula}\n\n${column.note}`
}
</script>

<template>
  <!-- Native <details>, because only Bootstrap's CSS is loaded and its collapse
       needs the JS bundle. Closed by default: this is the working, not the
       answer, and the page already leads with the answer. -->
  <details v-if="results" class="card mt-4 mb-3">
    <summary class="card-header">Beräkningen, år för år</summary>
    <div class="card-body">
      <p class="form-text mt-0">
        De tre reservtalen är deterministiska — de beror på kassaflödet, tidsperioden och
        avkastningsantagandet, men inte på hur portföljen faktiskt gått. Det är de som avgör vad ett
        år får betala ut.
      </p>

      <p class="formula-bar" :class="{ empty: !active }">
        <template v-if="active">
          <code>{{ active.formula }}</code>
          <span class="note">{{ active.note }}</span>
        </template>
        <template v-else
          >Håll muspekaren över en kolumnrubrik för att se hur den räknas ut.</template
        >
      </p>

      <div class="table-responsive computation-scroll">
        <table class="table table-sm table-hover computation mb-0">
          <thead>
            <tr>
              <th
                v-for="column in columns"
                :key="column.label"
                scope="col"
                tabindex="0"
                :title="describe(column)"
                @mouseenter="active = column"
                @focus="active = column"
                @mouseleave="active = null"
                @blur="active = null"
              >
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in years" :key="t">
              <td
                v-for="column in columns"
                :key="column.label"
                :class="{ input: column.input }"
                v-text="column.cell(t - 1)"
              />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </details>
</template>

<style scoped>
/* The card header is the disclosure control, so it has to look like one. The
   default marker is kept rather than replaced: it is the only thing on the card
   that says it opens. */
summary {
  cursor: pointer;
  user-select: none;
}

/* Two lines' worth of room reserved whether or not anything is hovered, so the
   table does not jump up and down as the pointer crosses the header row. */
.formula-bar {
  display: block;
  min-height: 4.5rem;
  margin-bottom: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--bs-border-color);
  border-radius: var(--bs-border-radius);
  background-color: var(--bs-tertiary-bg);
  font-size: 0.875rem;
}

.formula-bar.empty {
  color: var(--bs-secondary-color);
  font-style: italic;
}

.formula-bar code {
  display: block;
  margin-bottom: 0.25rem;
  color: var(--bs-emphasis-color);
}

.formula-bar .note {
  color: var(--bs-secondary-color);
}

/* A tall plan is a hundred rows, which would bury the rest of the page. Cap it
   and let the header stick, which is what a spreadsheet does. */
.computation-scroll {
  max-height: 26rem;
  overflow-y: auto;
}

.computation thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background-color: var(--bs-body-bg);
  cursor: help;
  white-space: nowrap;
}

/* Figures never wrap, and they line up on the right so magnitudes can be
   compared down a column at a glance. */
.computation td {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.computation thead th {
  text-align: right;
}

/* What the household typed, set apart from what the model made of it. */
.computation td.input {
  color: var(--bs-secondary-color);
}
</style>
