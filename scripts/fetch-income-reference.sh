#!/usr/bin/env bash
#
# Regenerates public/income-reference-YYYYMMDD.json from SCB's PxWeb API.
#
# The planner uses this to place a household's withdrawals on the Swedish
# income distribution. See the "Income reference data" section of CLAUDE.md
# for what the figures mean and when SCB publishes a new reference year.
#
# Usage:  scripts/fetch-income-reference.sh [output-dir]
#
# No API key is needed. The API is rate limited (30 calls / 10 s per IP), which
# the handful of calls below stays well under.

set -euo pipefail

OUT_DIR="${1:-public}"
API="https://api.scb.se/OV0104/v1/doris/sv/ssd/START/HE/HE0110"

# HE0110F/TabVX2DispInkN — fractiles of "ekonomisk standard", i.e. disposable
#   income per consumption unit. This is the series SCB itself uses to talk
#   about income distribution, and the one that is comparable across household
#   sizes.
# HE0110G/TabVXDispH1 — the same fractiles per household, without the
#   consumption-unit adjustment.
# HE0110F/TabVXDispI47 — median economic standard by age and household type.
#   Retirees are the relevant reference group for a drawdown plan, and they sit
#   well below the all-ages median, so comparing against "Riket, all ages" alone
#   would flatter every plan.
KE_TABLE="$API/HE0110F/TabVX2DispInkN"
HH_TABLE="$API/HE0110G/TabVXDispH1"
AGE_TABLE="$API/HE0110F/TabVXDispI47"

fetch() { # table, query-json
  curl -sS --fail-with-body -X POST -H 'Content-Type: application/json' -d "$2" "$1"
}

# The tables gain a reference year each January, so read the newest year out of
# the metadata rather than pinning one here.
latest_year() {
  curl -sS --fail-with-body "$1" | jq -r '.variables[] | select(.code=="Tid") | .values[-1]'
}

YEAR="$(latest_year "$KE_TABLE")"
HH_YEAR="$(latest_year "$HH_TABLE")"
AGE_YEAR="$(latest_year "$AGE_TABLE")"

# All three come from the same product (Inkomster och skatter, HE0110) and are
# published together. If they ever disagree, the mix would be undocumented in
# the output, so stop rather than emit it.
if [ "$YEAR" != "$HH_YEAR" ] || [ "$YEAR" != "$AGE_YEAR" ]; then
  echo "Reference years disagree: per-k.e. $YEAR, household $HH_YEAR, by-age $AGE_YEAR" >&2
  exit 1
fi

# P1..P99. The tables carry every percentile limit, so a lookup can be exact
# instead of interpolated between deciles.
PERCENTILES="$(jq -nc '[range(1;100) | "P\(.)"]')"

ke_query="$(jq -nc --argjson p "$PERCENTILES" --arg year "$YEAR" '{
  query: [
    {code: "Region",       selection: {filter: "item", values: ["00"]}},
    {code: "InkomstTyp",   selection: {filter: "item", values: ["DispInkInkl"]}},
    {code: "Spridning",    selection: {filter: "item", values: $p}},
    {code: "ContentsCode", selection: {filter: "item", values: ["000006RI"]}},
    {code: "Tid",          selection: {filter: "item", values: [$year]}}
  ],
  response: {format: "json"}
}')"

hh_query="$(jq -nc --argjson p "$PERCENTILES" --arg year "$YEAR" '{
  query: [
    {code: "Region",       selection: {filter: "item", values: ["00"]}},
    {code: "InkomstTyp",   selection: {filter: "item", values: ["DispInkInklEjke"]}},
    {code: "Spridning",    selection: {filter: "item", values: $p}},
    {code: "ContentsCode", selection: {filter: "item", values: ["000006T1"]}},
    {code: "Tid",          selection: {filter: "item", values: [$year]}}
  ],
  response: {format: "json"}
}')"

age_query="$(jq -nc --arg year "$YEAR" '{
  query: [
    {code: "Region",       selection: {filter: "item", values: ["00"]}},
    {code: "Alder",        selection: {filter: "item", values: ["20+", "50-64", "65+", "65-79", "80+"]}},
    {code: "Hushallstyp",  selection: {filter: "item", values: ["E91", "A10", "A55"]}},
    {code: "InkomstTyp",   selection: {filter: "item", values: ["DispInkInkl"]}},
    {code: "ContentsCode", selection: {filter: "item", values: ["000006RT"]}},
    {code: "Tid",          selection: {filter: "item", values: [$year]}}
  ],
  response: {format: "json"}
}')"

ke_raw="$(fetch "$KE_TABLE" "$ke_query")"
hh_raw="$(fetch "$HH_TABLE" "$hh_query")"
age_raw="$(fetch "$AGE_TABLE" "$age_query")"

# SCB reports tkr; the planner works in kronor throughout, so convert here and
# leave no unit ambiguity in the file.
to_kronor='
  reduce .data[] as $d ({};
    ($d.key[2] | ltrimstr("P") | tonumber) as $p
    | .[$p | tostring] = (($d.values[0] | tonumber) * 1000 | round))
'

RETRIEVED="$(date +%F)"
OUT="$OUT_DIR/income-reference-$(date +%Y%m%d).json"

jq -n \
  --arg year "$YEAR" \
  --arg retrieved "$RETRIEVED" \
  --argjson ke "$(jq "$to_kronor" <<<"$ke_raw")" \
  --argjson hh "$(jq "$to_kronor" <<<"$hh_raw")" \
  --argjson age "$(jq '
      {"E91": "samtliga personer", "A10": "ensamstående utan barn", "A55": "sammanboende utan barn"} as $types
      | [.data[] | {
          age: .key[1],
          householdType: $types[.key[2]],
          median: ((.values[0] | tonumber) * 1000 | round)
        }]' <<<"$age_raw")" '
{
  source: {
    agency: "SCB (Statistiska centralbyrån)",
    product: "Inkomster och skatter (HE0110)",
    tables: {
      perConsumptionUnit: "HE0110F/TabVX2DispInkN",
      perHousehold: "HE0110G/TabVXDispH1",
      medianByAge: "HE0110F/TabVXDispI47"
    },
    url: "https://www.scb.se/hitta-statistik/statistik-efter-amne/hushallens-ekonomi/hushallens-inkomster-tillgangar-och-skulder/inkomster-och-skatter/",
    attribution: "Källa: SCB",
    region: "Riket",
    referenceYear: ($year | tonumber),
    retrieved: $retrieved,
    publicationFrequency: "Annual, around 20 January, for the income year two years earlier.",
    regenerateWith: "scripts/fetch-income-reference.sh"
  },
  unit: "SEK per year, nominal, in the prices of the reference year",
  incomeConcept: "Disponibel inkomst inklusive kapitalvinst",
  notes: [
    "Percentile limits: the key is the percentile, the value the income at that boundary.",
    "Disposable income is the households total spendable cash, pensions included. A planner withdrawal is usually only one component of it.",
    "Capital gains are included, which fattens the top percentiles; the exkl.-kapitalvinst variants of the same tables are the alternative."
  ],
  consumptionUnitScale: {
    description: "SCB konsumtionsenhetsskala. Divide a household amount by the sum of its weights before comparing against perConsumptionUnit.",
    singleAdult: 1.00,
    cohabitingCouple: 1.51,
    additionalAdult: 0.60,
    firstChild0to19: 0.52,
    furtherChild0to19: 0.42
  },
  perConsumptionUnit: $ke,
  perHousehold: $hh,
  medianByAge: $age
}
' > "$OUT"

echo "Wrote $OUT (reference year $YEAR)"

# Only one of these files should be checked in; the date in the name is what
# tells us when the data is due for a refresh.
for stale in "$OUT_DIR"/income-reference-*.json; do
  [ "$stale" = "$OUT" ] || echo "Stale, remove with: git rm $stale" >&2
done

# The app fetches the file by name at runtime, so the dated filename has to be
# stated in the source too. Nothing derives one from the other, so check it
# here and fail loudly — a stale constant is a 404 at page load, which is a
# worse way to find out.
CONSUMER="src/planner/income.ts"
if [ -f "$CONSUMER" ] && ! grep -q "$(basename "$OUT")" "$CONSUMER"; then
  echo "" >&2
  echo "$CONSUMER still points at the previous file. Update it:" >&2
  echo "  export const INCOME_REFERENCE_FILE = '$(basename "$OUT")'" >&2
  exit 1
fi
