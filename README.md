# Deutsch

A personal German vocabulary app for a Dutch speaker. You type the German word, articles included, and spaced repetition (FSRS) decides when each word comes back. It runs offline on an iPhone as a home-screen web app, keeps all progress on the phone, and needs no account. The spec is in [PLAN.md](PLAN.md).

**Op je iPhone zetten**
1. Open **https://gnobbel.github.io/deutsch/** in **Safari** (niet in een andere browser).
2. Tik onderaan op de deelknop (het vierkantje met de pijl omhoog).
3. Scrol omlaag en tik op **Zet op beginscherm**, daarna op **Voeg toe**.
4. Open Deutsch voortaan **alleen via het icoon** op je beginscherm. Die app bewaart je voortgang apart van Safari.

**Let op:** als je het icoon verwijdert, ben je al je voortgang kwijt. Maak af en toe een backup via Instellingen → Backup maken en bewaar die in iCloud Drive.

Development: `npm install`, then `npm run serve` (app at http://localhost:8080/deutsch/) and `npm run check` before every push.
