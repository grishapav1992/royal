# Visual skin descriptions for NPCs

Each generated design receives its own short Russian description of the actual artwork, usually 4-12 words and at most 140 characters. The recognizer sees four standing views and an enlarged front view. It never receives the player's image request, another skin, conversation history or biography. Distinctive visible details take priority over generic clothing colors. Vision can still miss or misidentify details.

`CodexSkinDescriptions` uses the existing codex.sale credential, `CODEX_SALE_NPC_MODEL` (default `gpt-6-luna`) and Responses image inputs. The configured model must accept images. This does not change the image model or Mira's selected provider. The multimodal input follows the [official Responses image-input format](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses); compatibility is verified against the application's provider separately.

Descriptions are stored on immutable `generated_skins` rows, separately from the original request. A leased background worker analyzes each new variant. Failures retry with bounded backoff independently of the paid generation, without regenerating artwork, reserving another purchase or refunding a usable design. Two workers cannot claim the same live lease; expired results and deleted alternatives cannot revive or overwrite a skin. Unselected variants and their descriptions are deleted together. Existing wardrobe entries are queued only when a conversation first needs the equipped appearance, rather than scanning every old image.

`SkinStudioStore.appearanceContext(accountId)` is the reusable NPC entry point. It reads the currently equipped appearance from the server and verifies ownership and the saved selection. It returns only the skin id and generated visual description. It returns null for an unknown or pending description, a base character or an invalid ownership reference. It never substitutes the original request or a previous skin. An old skin's first conversation can therefore have unknown appearance while its description is prepared.

Mira refreshes this observation for each turn. The latest utterance is packaged with the current server observation, separate from plain stored dialogue. This keeps the newest look beside the question even when old turns describe a different costume. The package is constructed by the server; a player cannot replace its fields with a message. Technical field names are not shown in the conversation.

It describes a game costume, not a real profession, age, character or biography. Changing skins preserves the player's account memory, while the current observation takes priority over old mentions of appearance. Current clothing is not a permanent player fact. The same entry point can be used by future NPCs. No client-supplied context is accepted.

The atelier shows the generated phrase below each candidate and in the wardrobe. Description polling preserves the selected variant and keyboard focus; a delayed response cannot restore a discarded candidate after saving. The current price, two-variant offer, accepted legacy three-variant jobs, wallet settlement and game mathematics remain unchanged.

The schema migration only adds description, request, retry and lease metadata. Rollback to the previous compatible application leaves those columns and data intact and never restores a wallet or player database.

Run the focused skin-description, skin, Mira and browser tests. Live description probes use already generated sheets, so they create no new image generations or production player operations.
