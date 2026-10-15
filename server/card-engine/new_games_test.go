package main

import (
	"encoding/json"
	d "royal/card-engine/internal/domain"
	"testing"
)

var extraIDs = []string{"mississippi", "four-card", "crazy-four", "flush", "holdem-bonus", "oasis", "russian", "caribbean-draw", "rummy", "andar-bahar", "spanish", "exposure", "switch", "free-bet"}

func TestNewGamesRecoverAndSettle(t *testing.T) {
	for _, id := range extraIDs {
		t.Run(id, func(t *testing.T) {
			for n := 0; n < 40; n++ {
				r, e := evaluate(input{Game: id, Move: "start"})
				if e != nil {
					t.Fatal(e)
				}
				want := r.Scale
				if id == "crazy-four" || id == "switch" {
					want *= 2
				}
				if r.Debit != want {
					t.Fatalf("start debit %d want %d", r.Debit, want)
				}
				for turn := 0; !r.View.Ended && turn < 20; turn++ {
					recovered, e := evaluate(input{Game: id, Move: "view", Payload: r.Payload})
					if e != nil {
						t.Fatal("restore", e)
					}
					a, b := mustJSON(r.View), mustJSON(recovered.View)
					if a != b {
						t.Fatalf("view changed after restore %s != %s", a, b)
					}
					// Exercise both wager decisions and exchanges, not only folds.
					move := ""
					picks := []int(nil)
					preferences := []string{"no-insurance", "keep", "stand", "play1", "play", "check", "decline", "andar"}
					if n%2 == 0 && turn == 0 {
						preferences = append([]string{"exchange", "draw", "switch", "free-double", "free-split", "double"}, preferences...)
					}
					if id == "russian" && n%3 == 0 && turn == 0 {
						preferences = append([]string{"buy-sixth"}, preferences...)
					}
					preferences = append(preferences, "discard")
					for _, m := range preferences {
						for _, a := range r.View.Actions {
							if a.Move == m {
								move = m
								if a.MaxPicks > 0 {
									picks = []int{0}
									if a.MaxPicks > 1 {
										picks = []int{0, 1}
									}
								}
								break
							}
						}
						if move != "" {
							break
						}
					}
					if move == "" {
						t.Fatalf("no moves: %+v", r.View)
					}
					next, e := evaluate(input{Game: id, Move: move, Picks: picks, Payload: r.Payload})
					if e != nil {
						t.Fatalf("%s phase%d: %v", move, r.View.Phase, e)
					}
					var offered action
					for _, a := range r.View.Actions {
						if a.Move == move {
							offered = a
						}
					}
					if next.Debit != offered.Cost+offered.PerPick*len(picks) {
						t.Fatalf("debit %d offered %+v", next.Debit, offered)
					}
					r = next
				}
				if !r.View.Ended || len(r.View.Actions) != 0 {
					t.Fatalf("not settled: %+v", r.View)
				}
				if _, e = evaluate(input{Game: id, Move: "stand", Payload: r.Payload}); e == nil {
					t.Fatal("repeat settlement allowed")
				}
			}
		})
	}
}
func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
func TestHiddenInformationNewGames(t *testing.T) {
	for _, id := range extraIDs {
		r, e := evaluate(input{Game: id, Move: "start"})
		if e != nil {
			t.Fatal(e)
		}
		if r.View.Ended {
			continue
		}
		max := 0
		switch id {
		case "four-card", "oasis", "russian", "caribbean-draw", "spanish", "switch", "free-bet":
			max = 1
		case "exposure":
			max = 2
		}
		if len(r.View.Dealer) > max {
			t.Fatalf("%s leaks dealer", id)
		}
		if len(r.View.Community) > 0 {
			t.Fatalf("%s leaks future board", id)
		}
	}
}

func TestFreeBetActionsNeverChargeAndSplitsRemainVisible(t *testing.T) {
	for _, move := range []string{"free-double", "free-split"} {
		var v *d.FreeBetBlackjack
		for attempt := 0; attempt < 200; attempt++ {
			v = d.NewDefaultFreeBetBlackjack()
			v.SetChips(10000)
			if e := v.PlaceBet(100); e != nil {
				t.Fatal(e)
			}
			if v.GetPhase() == d.FreeBetPhasePlay {
				break
			}
		}
		if v.GetPhase() != d.FreeBetPhasePlay {
			t.Fatal("could not prepare a playable fixture")
		}
		// Force a legal hard ten or a pair without relying on a random deal.
		h := v.GetHands()[0]
		h.SetCard(0, d.NewCard(1, 5, true))
		h.SetCard(1, d.NewCard(2, 5, true))
		h.SetStood(false)
		h.SetBusted(false)
		p, _ := json.Marshal(v)
		r, e := evaluate(input{Game: "free-bet", Move: move, Payload: p})
		if e != nil {
			t.Fatal(e)
		}
		if r.Debit != 0 {
			t.Fatal("house-funded action charged player")
		}
		if move == "free-split" && len(r.View.Hands) != 2 {
			t.Fatal("split hand missing")
		}
	}
}
