package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	d "royal/card-engine/internal/domain"
)

// This process evaluates one server-owned snapshot. It has no accounts or wallet.
type game interface {
	GetChips() int
	SetChips(int)
	GetPhase() int
	GetGameEndFlag() bool
}
type input struct {
	Game    string          `json:"game"`
	Move    string          `json:"move"`
	Picks   []int           `json:"picks"`
	Side    bool            `json:"side"`
	Payload json.RawMessage `json:"payload"`
}
type action struct {
	Move     string `json:"move"`
	Label    string `json:"label"`
	Cost     int    `json:"cost"`
	PerPick  int    `json:"perPick,omitempty"`
	MinPicks int    `json:"minPicks,omitempty"`
	MaxPicks int    `json:"maxPicks,omitempty"`
}
type handView struct {
	Cards  []string `json:"cards"`
	Score  int      `json:"score"`
	Label  string   `json:"label"`
	Active bool     `json:"active"`
}
type view struct {
	Player    []string   `json:"player"`
	Dealer    []string   `json:"dealer"`
	Community []string   `json:"community"`
	Actions   []action   `json:"actions"`
	Phase     int        `json:"phase"`
	Ended     bool       `json:"ended"`
	Hands     []handView `json:"hands,omitempty"`
	Message   string     `json:"message"`
	Hint      []int      `json:"hint,omitempty"`
}
type reply struct {
	Payload json.RawMessage `json:"payload"`
	View    view            `json:"view"`
	Debit   int             `json:"debit"`
	Credit  int             `json:"credit"`
	Scale   int             `json:"scale"`
	Error   string          `json:"error,omitempty"`
}

func cards(list []*d.Card) []string {
	out := []string{}
	for _, c := range list {
		if c == nil {
			out = append(out, "??")
			continue
		}
		if c.GetDesign() == 0 {
			out = append(out, "JK")
			continue
		}
		out = append(out, fmt.Sprintf("%s%s", []string{"", "A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"}[c.GetValue()], []string{"", "S", "C", "H", "D"}[c.GetDesign()]))
	}
	return out
}
func one(c *d.Card) []*d.Card {
	if c == nil {
		return nil
	}
	return []*d.Card{c}
}
func evaluate(in input) (result reply, err error) {
	var g game
	switch in.Game {
	case "three-card":
		g = &d.ThreeCard{}
		if len(in.Payload) == 0 {
			g = d.NewDefaultThreeCard()
		}
	case "caribbean":
		g = &d.CaribbeanStud{}
		if len(in.Payload) == 0 {
			g = d.NewDefaultCaribbeanStud()
		}
	case "let-it-ride":
		g = &d.LetItRide{}
		if len(in.Payload) == 0 {
			g = d.NewDefaultLetItRide()
		}
	case "ultimate":
		g = &d.UltimateTexasHoldem{}
		if len(in.Payload) == 0 {
			g = d.NewDefaultUltimateTexasHoldem()
		}
	case "war":
		g = &d.CasinoWar{}
		if len(in.Payload) == 0 {
			g = d.NewDefaultCasinoWar()
		}
	case "red-dog":
		g = &d.RedDog{}
		if len(in.Payload) == 0 {
			g = d.NewDefaultRedDog()
		}
	case "pai-gow":
		g = &d.PaiGow{}
		if len(in.Payload) == 0 {
			g = d.NewDefaultPaiGow()
		}
	case "dragon-tiger":
		g = &d.DragonTiger{}
		if len(in.Payload) == 0 {
			g = d.NewDefaultDragonTiger()
		}
	case "deuces":
		g = &d.VideoPoker{}
		if len(in.Payload) == 0 {
			g = d.NewDeucesWildVideoPoker()
		}
	default:
		g = newGame(in.Game, len(in.Payload) == 0)
		if g == nil {
			return result, errors.New("unknown game")
		}
	}
	if len(in.Payload) > 0 {
		if err = json.Unmarshal(in.Payload, g); err != nil {
			return result, err
		}
	}
	if in.Move != "view" && len(in.Payload) > 0 && g.GetGameEndFlag() {
		return result, errors.New("round ended")
	}
	// Normalized rule chips never become a spendable balance. Royal checks all debits.
	const base = 1000000000
	g.SetChips(base)
	scale := 1000
	cost := 0
	if in.Game == "deuces" {
		scale = 5
	}
	if in.Game == "crazy-four" || in.Game == "free-bet" {
		scale = 100
	}
	side := 0
	if in.Side {
		side = 1000
	}
	switch v := g.(type) {
	case *d.ThreeCard:
		switch in.Move {
		case "start":
			cost = 1000 + side
			err = v.Bet(1000, side)
		case "play":
			cost = v.GetAnteBet()
			err = v.Play()
		case "fold":
			err = v.Fold()
		case "view":
		default:
			err = errors.New("bad move")
		}
	case *d.CaribbeanStud:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(1000, 0)
		case "play":
			cost = 2 * v.GetAnteBet()
			err = v.Play()
		case "fold":
			err = v.Fold()
		case "view":
		default:
			err = errors.New("bad move")
		}
	case *d.LetItRide:
		switch in.Move {
		case "start":
			cost = 3000
			err = v.Bet(1000)
		case "pull":
			err = v.Pull()
		case "ride":
			err = v.LetItRideAction()
		case "view":
		default:
			err = errors.New("bad move")
		}
	case *d.UltimateTexasHoldem:
		switch in.Move {
		case "start":
			cost = 2000 + side
			err = v.Bet(1000, side)
		case "play1", "play2", "play3", "play4":
			m := int(in.Move[4] - '0')
			cost = m * v.GetAnteBet()
			err = v.Play(m)
		case "check":
			err = v.Check()
		case "fold":
			err = v.Fold()
		case "view":
		default:
			err = errors.New("bad move")
		}
	case *d.CasinoWar:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(1000)
			if err == nil {
				v.ResolveInitial()
			}
		case "war":
			cost = v.GetAnte()
			err = v.GoToWar()
		case "surrender":
			err = v.Surrender()
		case "view":
		default:
			err = errors.New("bad move")
		}
	case *d.RedDog:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(1000)
			if err == nil {
				v.ResolveInitial()
			}
		case "raise":
			cost = v.GetAnte()
			err = v.Raise(cost)
		case "stay":
			err = v.Stay()
		case "view":
		default:
			err = errors.New("bad move")
		}
	case *d.PaiGow:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(1000)
		case "set":
			if len(in.Picks) != 2 {
				err = errors.New("select two cards")
			} else {
				err = v.SetHands(in.Picks[0], in.Picks[1])
			}
		case "auto":
			h := v.GetHint()
			if h == nil {
				err = errors.New("no split")
			} else {
				err = v.SetHands(h.LowIdx0, h.LowIdx1)
			}
		case "view":
		default:
			err = errors.New("bad move")
		}
	case *d.DragonTiger:
		switch in.Move {
		case "start-dragon", "start-tiger":
			cost = 1000
			kind := d.DragonTigerBetDragon
			if in.Move == "start-tiger" {
				kind = d.DragonTigerBetTiger
			}
			err = v.Bet(1000, kind)
		case "view":
		default:
			err = errors.New("bad move")
		}
	case *d.VideoPoker:
		switch in.Move {
		case "start":
			cost = 5
			err = v.Bet(5)
		case "hold":
			err = v.Hold(in.Picks)
		case "view":
		default:
			err = errors.New("bad move")
		}
	default:
		cost, err = extraMove(g, in, base)
	}
	if err != nil {
		return result, err
	}
	credit := g.GetChips() - base + cost
	if credit < 0 {
		return result, errors.New("invalid accounting")
	}
	out := view{Player: []string{}, Dealer: []string{}, Community: []string{}, Actions: []action{}, Phase: g.GetPhase(), Ended: g.GetGameEndFlag()}
	add := func(move, label string, cost int) {
		out.Actions = append(out.Actions, action{Move: move, Label: label, Cost: cost})
	}
	switch v := g.(type) {
	case *d.ThreeCard:
		out.Player = cards(v.GetPlayerHand())
		if out.Ended {
			out.Dealer = cards(v.GetDealerHand())
		} else {
			add("play", "Играть", 1000)
			add("fold", "Пас", 0)
		}
	case *d.CaribbeanStud:
		out.Player = cards(v.GetPlayerHand())
		dealer := v.GetDealerHand()
		if out.Ended {
			out.Dealer = cards(dealer)
		} else {
			out.Dealer = cards(dealer[:1])
			add("play", "Играть", 2000)
			add("fold", "Пас", 0)
		}
	case *d.LetItRide:
		out.Player = cards(v.GetPlayerHand())
		count := 0
		if out.Phase == d.LetItRidePhaseSecondDecision {
			count = 1
		}
		if out.Ended {
			count = 2
		}
		out.Community = cards(v.GetCommunityCards()[:count])
		if !out.Ended {
			add("pull", "Вернуть одну ставку", 0)
			add("ride", "Оставить ставку", 0)
		}
	case *d.UltimateTexasHoldem:
		out.Player = cards(v.GetPlayerHand())
		count := 0
		if out.Phase == d.UltimateTexasHoldemPhaseFlop {
			count = 3
		}
		if out.Phase >= d.UltimateTexasHoldemPhaseRiver {
			count = 5
		}
		out.Community = cards(v.GetCommunity()[:count])
		if out.Ended {
			out.Dealer = cards(v.GetDealerHand())
		} else {
			switch out.Phase {
			case d.UltimateTexasHoldemPhasePreFlop:
				add("play3", "Играть 3×", 3000)
				add("play4", "Играть 4×", 4000)
				add("check", "Пропустить", 0)
			case d.UltimateTexasHoldemPhaseFlop:
				add("play2", "Играть 2×", 2000)
				add("check", "Пропустить", 0)
			case d.UltimateTexasHoldemPhaseRiver:
				add("play1", "Играть 1×", 1000)
				add("fold", "Пас", 0)
			}
		}
	case *d.CasinoWar:
		out.Player = cards(append(one(v.GetPlayerCard()), one(v.GetPlayerWarCard())...))
		out.Dealer = cards(append(one(v.GetDealerCard()), one(v.GetDealerWarCard())...))
		if !out.Ended {
			out.Message = "Ничья: война или возврат половины ставки"
			add("war", "Война", 1000)
			add("surrender", "Забрать половину", 0)
		}
	case *d.RedDog:
		out.Player = cards(v.GetInitialCards())
		out.Community = cards(one(v.GetThirdCard()))
		out.Message = fmt.Sprintf("Разрыв между картами: %d", v.GetSpread())
		if !out.Ended {
			add("raise", "Повысить", 1000)
			add("stay", "Без повышения", 0)
		}
	case *d.PaiGow:
		out.Player = cards(v.GetPlayerCards())
		if out.Ended {
			out.Dealer = cards(v.GetDealerCards())
			out.Community = cards(v.GetPlayerLowHand())
		} else {
			h := v.GetHint()
			if h != nil {
				out.Hint = []int{h.LowIdx0, h.LowIdx1}
			}
			add("set", "Отложить две карты", 0)
			add("auto", "Разложить автоматически", 0)
		}
	case *d.DragonTiger:
		out.Player = cards(one(v.GetDragonCard()))
		out.Dealer = cards(one(v.GetTigerCard()))
	case *d.VideoPoker:
		out.Player = cards(v.GetHand())
		if !out.Ended {
			add("hold", "Заменить остальные", 0)
		} else {
			out.Message = v.GetHandName()
		}
	default:
		extraView(g, &out, in.Game)
	}
	if in.Game == "andar-bahar" && (in.Move == "andar" || in.Move == "bahar") {
		cost = 0
	}
	payload, err := json.Marshal(g)
	if err != nil {
		return result, err
	}
	return reply{Payload: payload, View: out, Debit: cost, Credit: credit, Scale: scale}, nil
}
func main() {
	var in input
	data, err := io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
	if err == nil {
		err = json.Unmarshal(data, &in)
	}
	var out reply
	if err == nil {
		out, err = evaluate(in)
	}
	if err != nil {
		out = reply{Error: err.Error()}
	}
	_ = json.NewEncoder(os.Stdout).Encode(out)
}
