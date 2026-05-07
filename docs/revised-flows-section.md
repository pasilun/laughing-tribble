# Product focus (post-2025-12-01)

The goal is **small projects without hiring an architect or guessing the rules**. A private person planning a komplementbyggnad, a tillbyggnad, an eldstad, a plank, or a similar small build should be able to use this app to find out what (if anything) needs to be submitted, design what needs designing, and produce whatever documentation the project requires — including documentation they keep themselves rather than send to kommunen.

The legal landscape changed on 1 December 2025. The terms *friggebod* and *attefallshus* are no longer used in lagtexten; they are replaced by **komplementbyggnad** and **komplementbostadshus**. Anmälningsplikten for the byggnationen itself is slopad for these. But anmälningsplikt remains for installations (vatten, avlopp, eldstad, rökkanal), bärande konstruktion, ventilation, ändrad planlösning i flerbostadshus, and rivning. BBR, EKS, strandskydd, k-märkning, and riksintressen continue to apply. Compliance is enforced through **kommunal tillsyn i efterhand**, with sanktionsavgifter for violations. The byggherre carries more responsibility than before.

This regulatory shift makes triage — figuring out which bucket a project falls into — the app's most valuable single feature. Most users get this wrong, in both directions: hiring an architect for a lovfri komplementbyggnad they could have built themselves, or building something that turns out to require bygglov and getting a sanktionsavgift.

## The three buckets

Every project resolves to exactly one of:

1. **Lovfri och anmälningsfri.** Nothing goes to kommunen. The app produces a *byggherre-dokumentation* packet: design, the rules that still apply (BBR, EKS, brandskydd, avstånd, pott-räkning), grannmedgivande templates if needed, kontrollplan the byggherre keeps for tillsyn-readiness.
2. **Anmälningspliktig.** App produces an anmälan packet for kommunens e-tjänst (often Mittbygge): anmälan, ritningar appropriate to the åtgärd, kontrollplan, certifierad sakkunnig om så krävs, brandskyddsdokumentation if relevant. Startbesked required before bygget påbörjas.
3. **Bygglovspliktig.** App produces a bygglovsansökan packet: ansökan, situationsplan, planritning, fasadritning, sektionsritning, teknisk beskrivning, kontrollplan, materialval, kulör. Beslut required before bygget påbörjas.

The triage decision and its reasoning is itself an output the user sees and can act on — citations to PBL, BBR, and (where relevant) the fastighetens detaljplan.

## First-class supported flows

1. **Komplementbyggnad inom detaljplan, lovfri** — förråd, garage, växthus, gäststuga utan boende. Inom potten (45 m² totalt på fastigheten, max 30 m² per byggnad, max 4 m nockhöjd, ≥4,5 m till tomtgräns). Output: byggherre-dokumentation.
2. **Komplementbostadshus inom detaljplan** — gäststuga med boende, kontor med kök/wc avsett som boende. Same dimensions, but BBR-bostadskrav apply. Vatten/avlopp/ventilation almost always triggers anmälan. Output: anmälan packet.
3. **Komplementbyggnad utanför detaljplan, lovfri** — ≤50 m², ≤4,5 m nockhöjd, inom utomplans-potten (65 m²). Output: byggherre-dokumentation. Förhandsbesked or strandskyddsdispens may still be required separately.
4. **Tillbyggnad lovfri** — upp till 30 m² på en- eller tvåbostadshus, inom potten, ej över huvudbyggnadens taknockshöjd. Output: byggherre-dokumentation. Anmälan if it touches bärande konstruktion.
5. **Eldstad / rökkanal** — ren anmälningsärende. Common, simple, high-value (most users don't realize a kassettkamin needs anmälan). Output: anmälan packet with placeringsritning, brandskyddsdokumentation, kontrollplan.
6. **Tillbyggnad bygglov** — anything outside the pott, breaching detaljplan, in k-märkt område, or where utökad lovplikt applies. Output: bygglovspacket.
7. **Plank / mur** — bygglov, simple geometry, clear rules. Good test case for the lov-flow without architectural complexity. Output: bygglovspacket.

These flows drive everything: parametric primitives, detaljplan checks, regulatory corpus, fixture set. Don't build for the general case.

## Out of scope (explicit)

Listed because users will ask:

- Nybyggnad av en- eller tvåbostadshus
- Tillbyggnad större än 30 m² eller över huvudbyggnadens höjd
- Komplementbyggnad eller -bostadshus över potten eller över storleksgränserna
- Större ändring av bärande konstruktion
- Flerbostadshus, kommersiellt, industri
- Rivning av huvudbyggnad
- K-märkta byggnader (kräver alltid arkitekt och antikvarisk kompetens)

App detects these at triage and recommends a fackman.

## Real-world test case

Patrik's country property outside Strängnäs, likely outside detaljplan. The MVP gate is **a real project at this property completed using only the app**, output good enough that not using the app would have meant calling kommunen or hiring a fackman. Whether the project becomes a real submission depends on what it is — eldstad anmälan, komplementbyggnad lovfritt with byggherre-dokumentation, or tillbyggnad bygglov — but the app must triage correctly, produce the right artifacts, and be useful enough to actually use.
