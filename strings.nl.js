// All UI text, in Dutch (PLAN §9).
export const S = {
  appName: 'Deutsch',
  tabs: { leren: 'Leren', woorden: 'Woorden', instellingen: 'Instellingen' },

  install: {
    title: 'Zet de app eerst op je beginscherm',
    steps: [
      'Tik in Safari onderaan op de deelknop (het vierkantje met de pijl omhoog).',
      'Kies „Zet op beginscherm” en tik op „Voeg toe”.',
      'Open Deutsch voortaan alleen via het icoon op je beginscherm.',
    ],
    why: 'De app op je beginscherm bewaart je voortgang apart van Safari. Wat je hier in Safari doet, zie je daar niet terug.',
    warning: 'Let op: als je het icoon verwijdert, ben je al je voortgang kwijt. Maak daarom af en toe een backup (Instellingen).',
    continueBrowser: 'Toch doorgaan in de browser',
  },
  welcome: {
    title: 'Welkom',
    body: 'Je voortgang wordt alleen op deze telefoon bewaard.',
    warning: 'Als je het icoon van je beginscherm verwijdert, ben je al je voortgang kwijt. Maak daarom af en toe een backup via Instellingen.',
    ok: 'Begrepen',
  },

  home: {
    title: 'Leren',
    start: 'Start',
    notYet: 'Het leren zelf komt in de volgende versie. Je kunt nu de instellingen en de backup al bekijken.',
    updateAvailable: 'Update beschikbaar',
    updateAction: 'Tik om bij te werken',
  },

  words: {
    title: 'Woorden',
    notYet: 'Hier komen later je woordenlijsten, zoeken en meldingen.',
  },

  settings: {
    title: 'Instellingen',
    learning: 'Leren',
    newPerDay: 'Nieuwe woorden per dag',
    newPerDayHint: '≈ 20–30 min per dag na een paar maanden',
    retention: 'Gewenst onthoudpercentage',
    retentionHint: 'Hoger betekent vaker herhalen.',
    ignoreCase: 'Hoofdletters negeren',
    umlautShortcuts: 'ae, oe, ue, ss goed rekenen als ä, ö, ü, ß',
    data: 'Gegevens',
    backup: 'Backup maken',
    backupHint: 'Bewaar het bestand in iCloud Drive („Bewaar in Bestanden”).',
    lastBackup: 'Laatste backup',
    never: 'nog nooit',
    shareBackup: 'Backup bewaren',
    backupReady: 'Backup klaar. Tik op „Backup bewaren” om hem op te slaan.',
    backupSaved: 'Backup gemaakt ✓',
    restore: 'Backup terugzetten',
    restoreTitle: 'Backup terugzetten?',
    restoreSummary: (s, date) => `Backup van ${date}: ${s.words} woorden, ${s.cards} kaarten, ${s.reviews} herhalingen.`,
    restoreWarning: 'Dit vervangt alles wat nu in de app staat.',
    restoreOk: 'Terugzetten',
    restored: 'Backup teruggezet ✓',
    reset: 'Alles wissen',
    resetTitle1: 'Alles wissen?',
    resetBody1: 'Al je voortgang, instellingen en meldingen worden gewist.',
    resetTitle2: 'Echt alles wissen?',
    resetBody2: 'Dit kun je niet ongedaan maken. Heb je een backup?',
    resetOk1: 'Ja, wissen',
    resetOk2: 'Definitief wissen',
    resetDone: 'Alles gewist',
    about: 'Over',
    version: 'Versie',
    cancel: 'Annuleren',
  },

  error: (msg) => `Er ging iets mis: ${msg}`,
};

export function formatDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return '?';
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}
