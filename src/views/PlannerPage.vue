<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'

import { usePlannerStore } from '../stores/planner'
import PlannerInputs from '../components/planner/PlannerInputs.vue'
import CashflowEditor from '../components/planner/CashflowEditor.vue'
import PlannerOutcome from '../components/planner/PlannerOutcome.vue'
import SensitivityCard from '../components/planner/SensitivityCard.vue'
import { EXTRA_AXIS, INFLATION_AXIS, NEED_AXIS, RETURN_AXIS } from '../planner/sensitivity'
import CollapsibleCard from '../components/planner/CollapsibleCard.vue'
import ComputationTable from '../components/planner/ComputationTable.vue'

const store = usePlannerStore()
const { error } = storeToRefs(store)

onMounted(() => {
  store.initUrlSync()
})
</script>

<template>
  <div class="container my-4">
    <header class="mb-4">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div>
          <h1 class="display-4">Kapitalplanerare</h1>
          <p class="lead text-muted mb-0">Fördelningen av realt kapital över tid, år för år.</p>
        </div>
        <RouterLink class="btn btn-outline-secondary" to="/">Till fondsimulatorn</RouterLink>
      </div>
    </header>

    <PlannerInputs />
    <CashflowEditor />

    <div v-if="error" class="alert alert-danger">
      {{ error }}
    </div>

    <template v-else>
      <!-- Everything above is what the household enters; everything below is
           what the model makes of it. The rule marks that break, which a run of
           otherwise unlabelled cards leaves the reader to infer. -->
      <h2 class="section-title">Resultat</h2>
      <PlannerOutcome />
      <!-- Last, because they answer a question the outcome raises: you read
           what the plan does, then ask how much of it depends on having judged
           the inputs right. Two grids rather than one four-way sweep, because
           the pairs are answerable separately — the household controls what it
           spends and does not control what the market does, so the two ask for
           different responses. Both compute only while open: nine propagations
           is seconds of main thread on an AF plan, and eighteen on every edit
           would make the cash flow editor unusable. -->
      <SensitivityCard
        title="Känslighet: uttag"
        body-id="planner-sensitivity-cashflow"
        :row-axis="NEED_AXIS"
        :col-axis="EXTRA_AXIS"
      />
      <SensitivityCard
        title="Känslighet: marknad"
        body-id="planner-sensitivity-market"
        :row-axis="RETURN_AXIS"
        :col-axis="INFLATION_AXIS"
      />
    </template>

    <!-- Between the results and the prose about the method: it is the working
         behind the former and the worked example of the latter, so it belongs
         to neither on its own. Closed by default so it does not stand between
         them for a reader who does not want it. -->
    <ComputationTable v-if="!error" />

    <!-- Closed by default, like the two cards above it. It is reference
         material rather than an answer, and open it is longer than everything
         the page actually computed. -->
    <CollapsibleCard title="Om metoden" body-id="planner-method-body" class="mt-4 mb-3">
      <div class="row g-4 method">
        <div class="col-12 col-lg-6">
          <p>
            Planeraren räknar fram hela fördelningen av realt kapital, år för år. Kapitalet
            representeras som ett rutnät av möjliga förmögenhetsnivåer, var och en med sin
            sannolikhet. För varje nivå integreras årets avkastning över en diskret
            normalfördelning, årets kassaflöde dras av och skatten tas ut; sannolikheten fördelas
            därefter ut på de nivåer utfallen hamnar på. Efter varje år finns alltså fördelningen i
            sin helhet, inte bara ett medelvärde eller ett intervall.
          </p>
          <p>
            Uttagen anges netto, som disponibla belopp. Uttag ur ett ISK beskattas inte i sig — i
            stället läggs schablonskatten på kapitalunderlaget, och den betalas ur portföljen utöver
            uttaget. Den minskar alltså inte det du får ut. Underlaget tas här som saldot vid årets
            slut, efter avkastning och uttag; lagen räknar i stället på genomsnittet av fyra
            kvartalsvärden plus årets insättningar, så modellen underskattar underlaget något under
            år då kapitalet minskar.
          </p>
          <p>
            Skatteparametrarna hålls konstanta över hela tidsperioden och kan ändras av riksdagen.
            Schablonräntan är satt till en långsiktig nivå i stället för det aktuella årets: för
            inkomstår 2026 är den 3,55&nbsp;%, men att hålla ett enskilt års ränta i fyrtio år låter
            kortsiktiga ränterörelser avgöra slutresultatet. Pensionernas prognosstandard undviker
            samma fälla och fixerar en långsiktig statslåneränta på 2,5&nbsp;%. Här används
            4&nbsp;%, vilket motsvarar en statslåneränta kring 3&nbsp;% — en halv procentenhet över
            standarden, i linje med att styrräntan väntas ligga högre mot 2030 än i dag. Fribeloppet
            är ett nominellt belopp som inte indexeras; 0 stänger av det.
          </p>
          <p>
            Att räkna på hela fördelningen är vad som gör uttagens ordningsberoende synligt. Varje
            förmögenhetsnivå bär med sig sin egen historia, så ett tidigt fall minskar underlaget
            för samtliga återstående uttag och slår igenom i fördelningens nedre del — något ett
            snitt eller en enkel framskrivning på förväntad avkastning inte kan visa.
          </p>
          <p>
            Planen räknas tre gånger: med enbart behovsuttaget, med behov plus hela det extra
            uttaget, och — den dynamiska körningen — med behov plus så mycket av det extra som går
            att bära. Bandet mellan de två fasta körningarna visar vad det extra uttaget kostar i
            slutkapital och risk. En plan räknas som sprucken det år portföljen inte klarar hela
            behovsuttaget, och det tillståndet är absorberande: en senare insättning räddar den
            inte. Percentilerna är ovillkorade, så spruckna utfall ligger kvar som noll kronor i
            fördelningen. Det är därför 10:e percentilen kan vara noll så snart risken att planen
            spricker överstiger 10&nbsp;%.
          </p>
          <p>
            Den dynamiska körningen rör aldrig behovet och tar aldrig mer än det extra hushållet
            angett — uttagen styrs alltså fortfarande av vad man faktiskt behöver, och saldot verkar
            bara som broms på den valfria delen. Varje år beräknas vad de återstående behovsuttagen
            kräver i reserv, och överskottet däröver fördelas över det extra som återstår i den form
            hushållet ritat den — ett år som begär dubbelt så mycket som sina grannar betjänas
            dubbelt så fort. Det beloppet, begränsat till det extra, är vad som tas. Reserven
            diskonteras inte till förväntad avkastning utan till 25:e percentilen av avkastningen,
            eftersom en median­ränta bara innebär att behovet är finansierat i hälften av utfallen.
            Varje åtagande diskonteras dessutom med räntan för sitt eget avstånd, inte för hela
            tidsperioden: spridningen krymper med tiden, så ett uttag några år bort förtjänar en
            betydligt lägre ränta än ett fyrtio år bort. Regeln behöver inget minne av tidigare år,
            till skillnad från intervallregler av Guyton–Klinger-typ, vars hysteres är just ett
            minne.
          </p>
          <p>
            Ett arvsmål läggs in som ytterligare ett åtagande i samma reserv: en andel av
            startkapitalet som ska finnas kvar realt vid periodens slut, diskonterad till i dag med
            planens medianavkastning — inte med behovets 25:e percentil, eftersom att missa arvet
            inte är att planen spricker och ett mål därför inte prissätts som ett golv. Därmed är
            det bara det extra uttaget som betalar för arvet — behovet rörs inte, och de två fasta
            körningarna påverkas inte alls. Målet mäts efter latent skatt, alltså det som faktiskt
            blir kvar till någon annan, vilket också är det enda sätt på vilket samma mål betyder
            samma sak i ett ISK och i ett AF-konto. Att missa målet räknas inte som att planen
            spricker; den frågan avgörs fortfarande av behovet ensamt.
          </p>
          <p class="mb-0">
            Modellen förutsätter att portföljen ombalanseras till sina målvikter varje år och att
            avkastningen är oberoende mellan år. Portföljens årsavkastning momentanpassas till en
            lognormal fördelning ur tillgångsslagens medelvärden, volatiliteter och korrelationer;
            medelvärdena är aritmetiska, eftersom modellen själv beräknar variansdraget. Siffrorna
            per tillgångsslag är redigerbara utgångspunkter, inte skattningar ur fonddatabasen — den
            innehåller enskilda fonder över korta, nominella perioder, medan en planeringsperiod på
            decennier behöver långsiktiga reala klassavkastningar.
          </p>
          <p class="mb-0">
            För ISK tas schablonskatten ut på saldot. Den är därmed samma andel realt som nominellt,
            så inflationen påverkar inte det reala resultatet annat än genom fribeloppet, som är
            skrivet i nominella kronor. Ett AF-konto beskattas i stället på omkostnadsbeloppet, som
            är ett andra tillstånd med egen historik: rutnätet spänner därför både kapital och
            omkostnadsbelopp, och skatten följer kvittning mellan schablonintäkt och realiserade
            vinster, skattereduktion för nettoförluster, genomsnittsmetoden vid delavyttring och
            uppräkning av den försäljning som betalar skatten. Hur mycket den årliga ombalanseringen
            realiserar är inget antagande utan följer av hur långt tillgångarna glider isär: den
            förväntade omsättningen räknas fram ur samma medelvärden, volatiliteter och
            korrelationer som avkastningen.
          </p>
        </div>
        <div class="col-12 col-lg-6">
          <h6 class="mt-0 mb-2">Källor</h6>
          <p class="mb-2">
            <em>Uttagsplanering och sekvensrisk.</em> Bengen, W. P. (1994),
            <q>Determining Withdrawal Rates Using Historical Data</q>, Journal of Financial Planning
            — problemet med ordningsberoende uttag. Milevsky, M. A. &amp; Robinson, C. (2005),
            <a href="https://www.ssrn.com/abstract=872871" target="_blank" rel="noopener"
              >A Sustainable Spending Rate without Simulation</a
            >, Financial Analysts Journal 61(6) — uttagsströmmen som ett stokastiskt nuvärde, där
            risken att pengarna tar slut är sannolikheten att nuvärdet överstiger startkapitalet.
            Dufresne, D. (1990),
            <q
              >The distribution of a perpetuity, with applications to risk theory and pension
              funding</q
            >, Scandinavian Actuarial Journal — den exakta fördelningen för det diskonterade
            uttagsflödet. Suarez, Suarez &amp; Walz (2015), <q>The Perfect Withdrawal Amount</q>,
            Financial Services Review.
          </p>
          <p class="mb-2">
            <em>Uttagsregler som anpassar sig.</em> Waring, M. B. &amp; Siegel, L. B. (2015),
            <a
              href="https://rpc.cfainstitute.org/research/financial-analysts-journal/2015/the-only-spending-rule-article-you-will-ever-need"
              target="_blank"
              rel="noopener"
              >The Only Spending Rule Article You Will Ever Need</a
            >, Financial Analysts Journal 71(1) — årligen omräknad virtuell annuitet, som inte kan
            ta slut eftersom uttaget alltid är en andel av det som är kvar. Guyton, J. &amp;
            Klinger, W. (2006), <q>Decision Rules and Maximum Initial Withdrawal Rates</q>, Journal
            of Financial Planning — intervallregler. Pfau, W. och Zwecher, M., om
            <a
              href="https://retirementresearcher.com/what-is-a-safety-first-retirement-plan/"
              target="_blank"
              rel="noopener"
              >safety-first</a
            >: säkra behovet först, betrakta resten som valfritt. Regeln här tillämpar
            annuitetstanken enbart på överskottet, vilket ger både ett garanterat behovsuttag och en
            del som inte kan ta slut.
          </p>
          <p class="mb-2">
            <em>Numerik.</em> Fördelningen förs framåt med en diskretiserad Chapman–Kolmogorov-
            operator, standardmetodik för framåtekvationer på rutnät; se Judd, K. (1998),
            <q>Numerical Methods in Economics</q>, MIT Press. Årets avkastning integreras med
            trapetsregeln, som konvergerar exponentiellt för integrander som avtar som en
            normalfördelning — Trefethen, L. N. &amp; Weideman, J. A. C. (2014),
            <q>The Exponentially Convergent Trapezoidal Rule</q>, SIAM Review 56(3). Portföljens
            avkastning momentanpassas till en lognormal fördelning enligt Fenton–Wilkinson; Fenton,
            L. F. (1960), IRE Transactions on Communications Systems 8(1).
          </p>
          <p class="mb-2">
            <em>Avkastningsantaganden.</em> Siffrorna följer
            <a
              href="https://www.minpension.se/allt-om-pensioner/pensionsprognos/prognosstandard"
              target="_blank"
              rel="noopener"
              >Prognosstandard för pensioner</a
            >, den standard Pensionsmyndigheten och pensionsbolagen enats om och som används i
            minPension: 6,5&nbsp;% nominellt för globala aktier, 2,5&nbsp;% för långa räntor och
            2&nbsp;% inflation, vilket ger 3,5&nbsp;% realt vid standardens 75/25-fördelning, före
            skatt och avgifter. Standarden är en deterministisk framskrivning, så dess tal är
            <em>ackumulerande</em> avkastning; värdena här är de aritmetiska medelvärden som återger
            samma ackumulerande takt vid respektive volatilitet. Volatiliteterna kommer inte från
            standarden, som inte anger några, utan är av den storleksordning Dimson, E., Marsh, P.
            &amp; Staunton, M. redovisar i
            <a
              href="https://www.ubs.com/global/en/investment-bank/insights-and-data/2025/global-investment-returns-yearbook-2025.html"
              target="_blank"
              rel="noopener"
              >Global Investment Returns Yearbook</a
            >
            (UBS, årlig) och <q>Triumph of the Optimists</q> (Princeton University Press, 2002).
          </p>
          <p class="mb-0">
            <em>Skatteregler och ränteläge.</em> Lag (2011:1268) om investeringssparkonto och
            inkomstskattelagen (1999:1229) om schablonintäkt. Aktuella satser från
            <a
              href="https://www.skatteverket.se/privat/skatter/beloppochprocent/2026.4.1522bf3f19aea8075ba21.html"
              target="_blank"
              rel="noopener"
              >Skatteverket, Belopp och procent 2026</a
            >: statslåneräntan 2,55&nbsp;% den 30 november 2025 plus en procentenhet ger 3,55&nbsp;%
            (lägst 1,25&nbsp;% enligt lag), och den skattefria grundnivån är 300 000 kronor från 1
            januari 2026. Skatteverket anger ingen årlig indexering av grundnivån, så den modelleras
            som nominellt fast och urholkas därmed realt av inflationen. Den långsiktiga nivån på
            schablonräntan utgår från
            <a
              href="https://www.konj.se/publikationer/konjunkturlaget/"
              target="_blank"
              rel="noopener"
              >Konjunkturinstitutets Konjunkturläget</a
            >, vars scenario har styrräntan stigande mot 2,5&nbsp;% fram till 2031, plus den
            terminspremie statslåneräntan i dag ligger över styrräntan. Prognosstandardens eget
            antagande är 2,5&nbsp;% statslåneränta.
          </p>
        </div>
      </div>
    </CollapsibleCard>
  </div>
</template>

<style scoped>
header {
  border-bottom: 2px solid var(--bs-border-color);
  padding-bottom: 1rem;
}

.display-4 {
  font-weight: 300;
}

/* The page header one step down: same light weight and the same 2px rule, at a
   size that carries across a screen of cards. It divides the page, so it needs
   more air above it than the cards keep between themselves — otherwise it reads
   as a caption belonging to the card below rather than as a heading over all of
   them. */
.section-title {
  font-size: 1.75rem;
  font-weight: 300;
  border-bottom: 2px solid var(--bs-border-color);
  padding-bottom: 0.75rem;
  margin-top: 2.5rem;
  margin-bottom: 1.5rem;
}

.method {
  font-size: 0.875rem;
  color: var(--bs-secondary-color);
}
</style>
