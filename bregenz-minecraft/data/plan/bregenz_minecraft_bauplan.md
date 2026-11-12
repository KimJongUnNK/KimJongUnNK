# Minecraft Bauplan & Koordinaten-Raster für Bregenz

Dieses Dokument dient als direktes Skript und Referenz für dein Minecraft-Projekt im **Maßstab 1:1** (1 Block = 1 Meter). Der Nullpunkt (0, 0) wurde virtuell auf das **vorarlberg museum** am Kornmarktplatz gelegt, um dir das Abmessen der Distanzen in Blöcken zu erleichtern.

---

## 1. Das globale Koordinaten-Raster (Relativ in Blöcken)

Nimm das **vorarlberg museum** als Startpunkt deiner Welt auf Minecraft-Ebene. Von dort aus kannst du die anderen Bauwerke über die angegebenen Block-Distanzen (X = Ost/West, Z = Nord/Süd) platzieren.

| Bauwerk / Fixpunkt | Reale Höhe (Y) | MC-Höhe (Y)* | Delta X (Ost+) | Delta Z (Süd+) | Beschreibung & Bautipp |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **vorarlberg museum** | 396 m | **Y: 396** | **0** | **0** | **Startpunkt.** Flache Betonfassade am Platz. |
| **Vorarlberger Landestheater** | 396 m | **Y: 396** | -8 | +45 | Liegt schräg gegenüber im Süden. Neoklassizistisch. |
| **Kunsthaus Bregenz (KUB)** | 396 m | **Y: 396** | +80 | -45 | Glaswürfel nordöstlich am Kornmarkt. |
| **Militärbad ("Mili")** | 396 m | **Y: 396** | +410 | -730 | Pfahlbau komplett im Wasser (Richtung Nordost). |
| **Bregenzer Seebühne** | 396 m | **Y: 396** | -650 | -10 | Liegt im Westen direkt im See-Wasser verankert. |
| **Fischersteg Pavillon** | 396 m | **Y: 396** | -230 | -20 | Holzsteg, der nach Nordwesten in den See ragt. |
| **Martinsturm (Oberstadt)** | 421 m | **Y: 421** | +220 | +440 | **Steilanstieg!** Liegt erhöht im Südosten. |
| **Deuring Schlössle** | 415 m | **Y: 415** | +110 | +430 | Sitzt direkt an der steilen Kante der Stadtmauer. |
| **Pfarrkirche St. Gallus** | 408 m | **Y: 408** | +240 | +760 | Steht isoliert südlich auf einem Felssporn. |
| **Burgruine Gebhardsberg** | 590 m | **Y: 590** | +260 | +1170 | **Massiver Berg.** Bewaldete Kuppe im Süden. |
| **Pfänderbahn Bergstation** | 1022 m | **Y: 1022** | +2450 | -55 | Extrem weit östlich am oberen Bergrand. |
| **Pfänderdohle Gasthaus** | 1005 m | **Y: 1005** | +2720 | -65 | In einer kleinen Mulde östlich der Bergstation. |

*\*Hinweis zur Bauhöhe:* Wenn deine Welt das normale Vanilla-Limit (Y=320) nutzt, musst du alle Y-Werte um ca. 400 Blöcke nach unten verschieben (z.B. Seeufer auf Y=60 setzen, damit der Pfänder bei Y=728 Platz hat, sofern die Weltgrenzen per Mod/Data Pack auf 1024 erweitert wurden).

---

## 2. Exakter Höhenstufen-Leitfaden (Terraforming)

Um das Gefälle zwischen der Unterstadt und dem Pfänder natürlich wirken zu lassen, nutze folgende mathematische Verhältnisse für deine Pinsel-Tools (WorldEdit / Voxelsniper):

1. **Die Ufer-Talsohle (Distanz 0 bis 600 Blöcke vom See):**
   * Gefälle: Fast 0%. 
   * Bauweise: Komplett eben lassen. Nur minimale Stufen (alle 50-100 Blöcke ein Block nach oben).
2. **Die Oberstadt-Kante (Distanz 600 bis 800 Blöcke):**
   * Gefälle: ca. 15% bis 20%.
   * Bauweise: Alle 5 bis 7 horizontalen Blöcke (X/Z) geht es 1 Block in die Höhe (Y).
3. **Der Pfänder-Steilhang (Ab Block 1000 Richtung Osten):**
   * Gefälle: ca. 40% Durchschnitt.
   * Bauweise: **Jeder 2. bis 3. Block geht nach oben.** Erzeuge raue, unregelmäßige Kanten aus Erde und Stein. Nutze dazwischen steile graue Bruchstein-/Felswände (1:1 Steigung).

---

## 3. Reale Geodaten-Referenz (Dezimalgrad)

Falls du externe Generatoren (wie World-Machine oder MapMC) füttern willst, sind hier die exakten Begrenzungen für deine Map-Aussparung:

* **Nord-West-Ecke (See/Pipeline):** `47.5120° N, 9.7210° O`
* **Süd-Ost-Ecke (Fluh/Pfänder):** `47.4890° N, 9.7835° O`