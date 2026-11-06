# Idéer

Saker vi har pratat om men inte byggt. Ta bort en idé när den är gjord eller avförd.

## Enkel observability: se hur verktyget används (2026-11-04)

**Behovet.** Se vem som använder verktyget, hur mycket, och om något går sönder, efter att fler vänner bjudits in. Vercel Hobby sparar körloggar bara i en timme och visar inte vem som gjorde vad, och appen loggar ingenting om användning.

**Förslag A (valt som riktning): färdiga tjänster med gratisnivå.**
- PostHog (EU-region) för användning: en händelse per verktygsanrop med användarnamn, verktygsnamn, lyckat eller fel, varaktighet. Gratis ca 1 miljon händelser/månad (kontrollera aktuell gräns).
- Sentry för fel: stack och vilken person det gällde. Gratis ca 5 000 fel/månad (kontrollera).
- Insats: några rader i MCP-anropet (`/api/mcp`) och felhanteringen, plus två miljövariabler i Vercel (Production). Skicka aldrig planinnehåll eller ritningar, bara metadata.
- Kräver: två gratiskonton som ägaren skapar, nycklarna som miljövariabler.
- Nackdel: användarnamn och verktygsnamn lämnar vår lagring. Berätta det för de inbjudna (en rad på inbjudningssidan).

**Förslag B: egen räkning i appen.**
- Ett litet dokument per person och dag i lagringen (`system/usage/<dag>/<person>.json`) med antal anrop per verktyg, fel och senast aktiv; en felpost med de senaste ca 100 felen.
- Admin-sida `/plans/usage` (samma behörighet som `/plans/people`): en rad per person, klick ger verktyg per dag och senaste fel.
- Ungefärliga räknare (samtidiga anrop kan räknas som ett), inget externt.

**Ej värt först:** Vercel Web Analytics (säger inget om Claude-anrop), Axiom via Vercels loggflöde (kräver troligen betalplan hos Vercel).

**Öppet:** välja A eller B (eller A för fel och B för användning); mäta varaktighet per anrop; information till inbjudna.

## Nattlig backup utanför appen

**Varför:** data ligger nu bara i Turso (gratisnivån). Backupen i appen (`/api/plans/backup`) kräver att någon laddar ner den för hand. En databas som förloras eller ett misstag i koden tar då allt med sig.

**Förslag:** ett schemalagt jobb (GitHub Actions, `schedule`, en gång per natt) som anropar `GET /api/plans/backup?all=1` med administratörens nyckel och lägger zip-filen någonstans utanför Turso:
- Som artefakt i GitHub Actions (gratis, 90 dagar, men räknas mot lagringskvoten), eller
- på Google Drive (något vi redan har), eller
- i en privat release/gren (bara om innehållet är okej att ligga hos GitHub).

**Att bestämma:** var filen ska ligga, hur länge den sparas (t.ex. 14 dagar rullande), och hur administratörens nyckel förvaras (som hemlighet i GitHub, aldrig i koden). Kontrollera zip-storleken mot gränserna (Vercel-funktionens tid och GitHubs artefaktgräns) innan det aktiveras. Prova återställning med `npm run restore:backup` mot en tom lagring minst en gång.
