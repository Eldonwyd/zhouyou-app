# AI Travel Planning Implementation Plan

This document summarizes the requirements and implementation history for Zhouyou Map. Sections are organized by feature. Date-specific checks below describe the recorded development checks.

## Planner design and data

- **Scope and inputs (1–2).** Preserve structured controls and allow free-form requirements. Accept a departure date, an end date, or a trip length. Use inclusive dates and limit routing to the destination and transfers between destinations. Count adult, student, senior, and child travelers independently.
- **Editing and discussion (3–5).** Display itineraries as editable activity cards. General questions and hypotheticals return advice. Explicit edits apply within the selected scope. Offer separate actions for alternative proposals and keep saved answers tied to the relevant itinerary version. Preserve locked activities, an undo history, and readable names in place of internal identifiers.
- **Maps and sources (6–7).** Use an interactive geographic basemap with daily filters, source links, and Amap search links. Keep approximate locations visibly approximate. Resolve places using public sources by default, with optional provider credentials for enhanced search.
- **Costs and persistence (8–9).** Normalize provider output, calculate budgets in integer cents, and support category, traveler, room, vehicle, and package pricing. Keep actual spending separate from the suggested budget. Keep the planner, history, conversations, and photos compatible with local storage and ZIP backups.
- **Delivery and validation (10–12).** Verify plan generation, edits, locked activities, location lookup, estimates, backup restore, mobile layouts, and simulated provider integrations. Use real provider calls only for explicit live checks. Record source dates and keep unclear prices, availability, and weather marked for confirmation.
- **Open-source delivery (13).** Each deployment uses its own AI configuration and optional search credentials. Use public photo sources by default. Third-party Xiaohongshu account search is optional and uses a local session. Keep credentials, account state, and runtime caches out of source, builds, and backups.

## Photos and AI workflows (November 11–12)

| Section | Change |
| --- | --- |
| 14. Photo search performance | Inspect candidates quickly and use the configured AI to choose among credible titles and captions when appropriate. Bound the search time, show progress, and allow cancellation. |
| 15. Scenic Xiaohongshu images | Search by city and attraction. Prefer scenic images and screen out text-heavy covers. |
| 16. Progressive imagery | Show the itinerary first and add photos in the background. Keep usable photos when a replacement fails. |
| 17. Themes | Offer warm paper and dark night themes, with a system preference option. |
| 18. Search concurrency | Cap automatic photo lookup at two concurrent requests and reduce repeated searches. |
| 19. Photo screening | Run local checks for text, collages, and dominant portraits. Try covers first, then a limited number of note images. |
| 20. Traveler categories | Collapse optional traveler categories, hide generated condition labels, and handle separate adult, student, senior, and child ticket pricing. |
| 21. AI interaction | Improve answer readability, support Enter to send and Shift+Enter for new lines, summarize route and pace, and avoid duplicate ticket items. |
| 22. Progress and links | Show brief progress while work is active. List actual, directly accessible source links separately. |
| 23. Search and alternatives | Search Xiaohongshu when requested or when facts are uncertain. Estimate lodging and food costs and provide actions to apply, discuss, or save alternatives. |
| 24. Image retention | Reuse photos for unchanged stops after an edit. Search again for new or relocated activities. |
| 25. Sign-in panel | Keep the optional Xiaohongshu panel focused on sign-in and show elapsed wait time for status checks. |
| 26. Itinerary overview | Place the overview ahead of the AI assistant and make trip cards larger. |
| 27. Provider configuration | Place AI configuration beside the assistant and support independently stored settings for multiple providers. |
| 28. Access and launcher | Document local, LAN, and authorized private-network access. Keep an AI launcher available while browsing and display progress only during work. |
| 29. Interaction conventions | Preserve source attribution, allow provider and photo settings to be optional, and keep iteration and live checks separate from normal tests. |
| 30. Provider-specific web search | DeepSeek and Zhipu can return page content. OpenAI, Gemini, Claude, and Qwen can return links for local retrieval. Other providers can use an enabled secondary provider or mark results as unchecked. Store per-provider settings in `.env.local`, support switching providers, and show the active model and search source. Use a full-width itinerary card with route, costs, photos, and daily highlights. |

## Itinerary map, ticketing, and journal (November 15–16)

| Section | Change |
| --- | --- |
| 31. Activity guides | Add AI-assisted guides within activities and retain links and source context. |
| 32–34. Ticket planning | Start with a ticket planning entry point, then generate and synchronize booking requirements automatically. Fold the ticket plan and hide items that require no reservation. |
| 35. Interactive map | Add a key-free online map, day-specific position corrections, and explicit hotel details when known. |
| 36. Food guides | Prefer identifiable shops when evidence supports them and let users collapse guide text. |
| 37. Background geocoding | Resolve stops incrementally, reuse confirmed coordinates, and continue checking after individual failures. |
| 38. Route presentation | Add daily stop numbering, place names, and directional indication to the route. |
| 39. Supplemental locations | Normalize long administrative names and support approximate neighborhoods and meal locations. Preserve attribution and accuracy for local Overture and Wikidata data. The small Yunnan data pack supplements online lookup. |
| 40. City picker | Start with the journal's city picker collapsed. |
| 41. Place memories | Append and edit individual written notes. Associate multiple recordings with a place without overwriting notes. Load audio metadata, clean up recording resources, and preserve the download option. |
| 42. Linked budgets | Open an itinerary's budget directly. Save newly linked trips and spending together and preserve edits during background refreshes. |
| 43. Daily ledger | Support breakfast, lunch, dinner, transport, tickets, lodging, and other costs. Compute exact daily and trip totals, preserve unallocated legacy food costs, and show separate currency and input columns. |
| 44. Budget prefill | Use the planner's cost calculation to prefill daily expenses once, including group, discount, package, and room rules. Keep later user edits and zero values. |
| 45–46. Ledger details | Remove the duplicate focus outline and the redundant prefill note while preserving the ledger behavior. |
| 47. Calendar reminders | Move calendar export to My Itineraries and retain the selected lead time, including a verified three-day reminder. |
| 48. Text export | Keep the essential itinerary details in the text export. |
| 49–50. Warm Days design | Extend the preview style to the full app, including the map, journal, planner, achievements, and profile. Remove the decorative sidebar note and reuse the existing record and storage flows. |
| 51–52. Appearance styles | Add persistent appearance preferences, independent light and dark settings, and a neutral white style. Update map colors without changing visit records. |

## Layout and geocoding fixes (November 17)

- **53. Map labels.** Register ECharts collision handling. Apply initial pixel offsets to dense labels around Hong Kong, Macao, Beijing, Tianjin, and Hebei, then fade those offsets as the zoom approaches 3×. Use the same layout logic for gestures, buttons, and reset.
- **54. National map framing.** Use continental bounds and container sizing for the initial view while retaining the geographic data and the South China Sea inset. Reset returns to the same framing.
- **55–56. Trip cards.** Constrain portrait images so they cannot cover the daily route. Tighten spacing and keep mobile photos at a fixed height. Verify the layout at 1772, 1024, and 390 pixels.
- **57. Tianjin stops.** Normalize city-prefixed names, verify up to three Wikidata administrative levels, and use coordinates from a linked article when the verified entity has none. Continue geocoding after individual errors, display unresolved reasons, and retry older failures after bumping the lookup version. Public data checks resolved the Italian Style Area and Five Great Avenues.

## Booking, transport, and guide updates (November 19)

- **58. Packing, expenses, and exports.** Add editable AI packing lists and reusable templates, group expense settlement in integer cents, a self-contained offline HTML itinerary, and manual or screenshot-based booking import. Persist structured bookings and apply confirmed costs to the proper day. The HTML export includes self-contained photos, printing styles, timeline, tickets, bookings, and the checklist. Verify expense settlement, multi-night hotels, rail imports, and HTML escaping.
- **59. Local OCR.** Use PP-OCRv5 with ONNX Runtime to extract screenshot text locally and pass only the text to DeepSeek for structured parsing. Verify downloaded models and retain screenshots only in memory. Test train, station, fare, gate, hotel dates, and final payment fields.
- **60. Booking lookup.** Use `/api/planner/booking-lookup` for schedules and reference rail fares. Match the intended rail segment and show intermediate stops. Flight lookup returns airports and scheduled times. Users confirm flight dates and enter the amount paid.
- **61. Import reliability.** Serve the planner API on the development web port and share request handling with production. Store an imported payment as the amount paid and reserve source validation for researched prices. Avoid counting a booking twice when creating a ledger. A simulated train screenshot was imported with the expected train number and payment.
- **62. Transfers between stops.** Include estimated distance, time, service, stops, and group cost between nearby activities. Respect the party's selected transport preference. Compare transit fares with the number of vehicles needed and retain full cards for intercity travel and confirmed bookings. Show concise transfer summaries by default.
- **63. Collapsible AI assistant.** Start collapsed, preserve drafts and conversations, and scroll to and focus the input when opened from the launcher. Check keyboard behavior and desktop and mobile layouts.
- **64. City guides.** Provide separate Xiaohongshu activity and food search links in the journal and AI overview, grouped by city for multi-city trips. Verify link encoding, new-tab behavior, mobile wrapping, and live searches for Shanghai.
- **Compact transfer connectors.** Store structured `transferOptions` with walking, subway, bus, taxi, or driving details where useful. Budget only the recommended option. Remember the user's selected alternative and include it in offline export. Load details for older itineraries through `/api/planner/transfers` and retain the result in `legTransfers`. Driving preferences show distance and time only. A longer taxi leg can include a separately marked rideshare estimate when warranted. Validate output normalization, the browser workflow, and the production build.

Deployment-specific addresses and credentials belong in local configuration. Use placeholders such as `http://<LAN-IP>:5173/` and `http://<Tailscale-device-IP>:5173/` in public instructions. Limit local AI services to authorized users when exposing them beyond the host.
