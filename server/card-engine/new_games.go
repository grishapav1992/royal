package main

import (
	"errors"
	"fmt"
	d "royal/card-engine/internal/domain"
)

// These adapters settle one round independently of the upstream practice bankroll.
type royalBlackjack struct{ *d.BlackJack }

func (v *royalBlackjack) GetChips() int  { return v.GetPlayer().GetChips() }
func (v *royalBlackjack) SetChips(n int) { v.GetPlayer().SetChips(n); v.GetDealer().SetChips(n) }

type royalSwitch struct{ *d.BlackJackSwitch }

func (v *royalSwitch) GetChips() int  { return v.GetPlayer().GetChips() }
func (v *royalSwitch) SetChips(n int) { v.GetPlayer().SetChips(n); v.GetDealer().SetChips(n) }

type royalCrazy struct{ *d.CrazyFourPoker }

func (v *royalCrazy) GetPhase() int { return int(v.CrazyFourPoker.GetPhase()) }
func (v *royalCrazy) GetGameEndFlag() bool {
	return v.GetPhase() == int(d.CrazyFourPokerPhaseResult) || v.CrazyFourPoker.GetGameEndFlag()
}

type royalFree struct{ *d.FreeBetBlackjack }

func (v *royalFree) GetPhase() int { return int(v.FreeBetBlackjack.GetPhase()) }
func (v *royalFree) GetGameEndFlag() bool {
	return v.GetPhase() == int(d.FreeBetPhaseResult) || v.FreeBetBlackjack.GetGameEndFlag()
}
func newGame(id string, fresh bool) game {
	switch id {
	case "mississippi":
		if fresh {
			return d.NewDefaultMississippiStud()
		}
		return &d.MississippiStud{}
	case "four-card":
		if fresh {
			return d.NewDefaultFourCardPoker()
		}
		return &d.FourCardPoker{}
	case "crazy-four":
		if fresh {
			return &royalCrazy{d.NewDefaultCrazyFourPoker()}
		}
		return &royalCrazy{&d.CrazyFourPoker{}}
	case "flush":
		if fresh {
			return d.NewDefaultHighCardFlush()
		}
		return &d.HighCardFlush{}
	case "holdem-bonus":
		if fresh {
			return d.NewDefaultTexasHoldemBonus()
		}
		return &d.TexasHoldemBonus{}
	case "oasis":
		if fresh {
			return d.NewDefaultOasisPoker()
		}
		return &d.OasisPoker{}
	case "russian":
		if fresh {
			return d.NewDefaultRussianPoker()
		}
		return &d.RussianPoker{}
	case "caribbean-draw":
		if fresh {
			return d.NewDefaultCaribbeanDraw()
		}
		return &d.CaribbeanDraw{}
	case "rummy":
		if fresh {
			return d.NewDefaultThreeCardRummy()
		}
		return &d.ThreeCardRummy{}
	case "andar-bahar":
		if fresh {
			return d.NewDefaultAndarBahar()
		}
		return &d.AndarBahar{}
	case "spanish":
		if fresh {
			return &royalBlackjack{d.NewSpanish21BlackJack()}
		}
		return &royalBlackjack{&d.BlackJack{}}
	case "exposure":
		if fresh {
			return &royalBlackjack{d.NewDoubleExposureBlackJack()}
		}
		return &royalBlackjack{&d.BlackJack{}}
	case "switch":
		if fresh {
			return &royalSwitch{d.NewDefaultBlackJackSwitch()}
		}
		return &royalSwitch{&d.BlackJackSwitch{}}
	case "free-bet":
		if fresh {
			return &royalFree{d.NewDefaultFreeBetBlackjack()}
		}
		return &royalFree{&d.FreeBetBlackjack{}}
	}
	return nil
}
func extraMove(g game, in input, base int) (cost int, err error) {
	if in.Move == "view" {
		return 0, nil
	}
	m := 1
	if len(in.Move) == 5 && in.Move[:4] == "play" {
		m = int(in.Move[4] - '0')
	}
	bad := errors.New("bad move")
	switch v := g.(type) {
	case *d.MississippiStud:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(cost)
		case "play1", "play2", "play3":
			cost = 1000 * m
			err = v.Play(m)
		case "fold":
			err = v.Fold()
		default:
			err = bad
		}
	case *d.FourCardPoker:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(cost, 0)
		case "play1", "play2", "play3":
			cost = 1000 * m
			err = v.Play(m)
		case "fold":
			err = v.Fold()
		default:
			err = bad
		}
	case *royalCrazy:
		switch in.Move {
		case "start":
			cost = 200
			err = v.PlaceBet(100, 0)
		case "play1", "play2", "play3":
			cost = 100 * m
			err = v.Play(m)
		case "fold":
			err = v.Fold()
		default:
			err = bad
		}
	case *d.HighCardFlush:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(cost, 0, 0)
		case "play1", "play2", "play3":
			cost = 1000 * m
			err = v.Raise(m)
		case "fold":
			err = v.Fold()
		default:
			err = bad
		}
	case *d.TexasHoldemBonus:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(cost, 0)
		case "play":
			cost = 2000
			err = v.Play()
		case "raise":
			cost = 1000
			err = v.Raise()
		case "check":
			err = v.Check()
		case "fold":
			err = v.Fold()
		default:
			err = bad
		}
	case *d.OasisPoker:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(cost, 0)
		case "exchange":
			cost = 1000 * len(in.Picks)
			err = v.Exchange(in.Picks)
		case "stand":
			err = v.Stand()
		case "play":
			cost = 2000
			err = v.Play()
		case "fold":
			err = v.Fold()
		default:
			err = bad
		}
	case *d.RussianPoker:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(cost)
		case "exchange":
			cost = 1000 * len(in.Picks)
			err = v.Exchange(in.Picks)
		case "buy-sixth":
			cost = 1000
			err = v.Buy6th()
		case "discard":
			if len(in.Picks) != 1 {
				err = bad
			} else {
				err = v.Select(in.Picks[0])
			}
		case "play":
			cost = 2000
			err = v.Play()
		case "fold":
			err = v.Fold()
		case "force":
			cost = 1000
			err = v.ForceExchange()
		case "decline":
			err = v.Decline()
		default:
			err = bad
		}
	case *d.CaribbeanDraw:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(cost, 0)
		case "draw":
			if len(in.Picks) > 0 {
				cost = 1000
			}
			err = v.Draw(in.Picks)
		case "stand":
			err = v.Draw(nil)
		case "play":
			cost = 2000
			err = v.Play()
		case "fold":
			err = v.Fold()
		default:
			err = bad
		}
	case *d.ThreeCardRummy:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.Bet(cost, 0)
		case "play":
			cost = 1000
			err = v.Play()
		case "fold":
			err = v.Fold()
		default:
			err = bad
		}
	case *d.AndarBahar:
		switch in.Move {
		case "start":
			cost = 1000
			v.SetChips(base - cost)
		case "andar", "bahar":
			cost = 1000
			target := 0
			if in.Move == "bahar" {
				target = 1
			}
			err = v.Bet(cost, target, 0, -1)
		default:
			err = bad
		}
	case *royalBlackjack:
		switch in.Move {
		case "start":
			cost = 1000
			err = v.PlayerBet(cost, 0, 0, 1)
		case "hit":
			err = v.PlayerHit()
		case "stand":
			err = v.PlayerStand()
		case "insurance":
			cost = 500
			err = v.PlayerInsurance()
		case "no-insurance":
			err = v.PlayerDeclineInsurance()
		case "surrender":
			err = v.PlayerSurrender()
		case "double", "split":
			h := v.GetPlayerHands()[v.GetCurrentHandIdx()]
			cost = h.GetBet()
			if in.Move == "double" {
				err = v.PlayerDoubleDown()
			} else {
				err = v.PlayerSplit()
			}
		default:
			err = bad
		}
	case *royalSwitch:
		switch in.Move {
		case "start":
			cost = 2000
			err = v.PlayerBet(1000)
		case "switch":
			err = v.PlayerSwitch()
		case "keep":
			err = v.PlayerKeep()
		case "hit":
			err = v.PlayerHit()
		case "stand":
			err = v.PlayerStand()
		case "double":
			cost = v.GetHands()[v.GetCurrentHandIdx()].GetBet()
			err = v.PlayerDoubleDown()
		default:
			err = bad
		}
	case *royalFree:
		switch in.Move {
		case "start":
			cost = 100
			err = v.PlaceBet(cost)
		case "hit":
			err = v.Hit()
		case "stand":
			err = v.Stand()
		case "free-double":
			err = v.FreeDouble()
		case "free-split":
			err = v.FreeSplit()
		default:
			err = bad
		}
	default:
		err = bad
	}
	return
}
func addHands(out *view, hands []*d.BlackJackHand, active int) {
	for i, h := range hands {
		out.Hands = append(out.Hands, handView{Cards: cards(h.GetCards()), Score: h.GetScore(), Label: fmt.Sprintf("Рука %d", i+1), Active: !out.Ended && i == active})
	}
}
func extraView(g game, out *view, id string) {
	add := func(m, l string, c int) { out.Actions = append(out.Actions, action{Move: m, Label: l, Cost: c}) }
	selectCards := func(m, l string, c, p, min, max int) {
		out.Actions = append(out.Actions, action{Move: m, Label: l, Cost: c, PerPick: p, MinPicks: min, MaxPicks: max})
	}
	plays := func(max, ante int) {
		for m := 1; m <= max; m++ {
			add(fmt.Sprintf("play%d", m), fmt.Sprintf("Играть %d×", m), m*ante)
		}
		add("fold", "Пас", 0)
	}
	dealer := func(list []*d.Card, count int) {
		if out.Ended {
			out.Dealer = cards(list)
		} else if len(list) >= count {
			out.Dealer = cards(list[:count])
		}
	}
	switch v := g.(type) {
	case *d.MississippiStud:
		out.Player = cards(v.GetPlayerHand())
		for i, revealed := range v.GetCommunityRevealed() {
			if revealed {
				out.Community = append(out.Community, cards(one(v.GetCommunityCards()[i]))...)
			}
		}
		if !out.Ended {
			plays(3, 1000)
		}
	case *d.FourCardPoker:
		out.Player = cards(v.GetPlayerHand())
		if out.Ended {
			out.Dealer = cards(v.GetDealerHand())
		} else {
			out.Dealer = cards(one(v.GetDealerUpCard()))
			plays(3, 1000)
		}
	case *royalCrazy:
		out.Player = cards(v.GetPlayerHand())
		dealer(v.GetDealerHand(), 0)
		if !out.Ended {
			max := 1
			if v.PlayerHasAcesOrBetter() {
				max = 3
			}
			plays(max, 100)
		}
	case *d.HighCardFlush:
		out.Player = cards(v.GetPlayerHand())
		dealer(v.GetDealerHand(), 0)
		out.Message = fmt.Sprintf("Карт одной масти: %d", v.GetPlayerFlushLen())
		if !out.Ended {
			plays(v.MaxRaiseMultiplier(), 1000)
		}
	case *d.TexasHoldemBonus:
		out.Player = cards(v.GetPlayerHand())
		dealer(v.GetDealerHand(), 0)
		n := 0
		if out.Phase == d.TexasHoldemBonusPhaseFlop {
			n = 3
		}
		if out.Phase == d.TexasHoldemBonusPhaseTurn {
			n = 4
		}
		if out.Ended {
			n = 5
		}
		if n > len(v.GetCommunity()) {
			n = len(v.GetCommunity())
		}
		out.Community = cards(v.GetCommunity()[:n])
		if !out.Ended {
			if out.Phase == d.TexasHoldemBonusPhasePreFlop {
				add("play", "Играть", 2000)
				add("fold", "Пас", 0)
			} else {
				add("check", "Чек", 0)
				add("raise", "Повысить", 1000)
			}
		}
	case *d.OasisPoker:
		out.Player = cards(v.GetPlayerHand())
		dealer(v.GetDealerHand(), 1)
		if !out.Ended {
			if out.Phase == d.OasisPokerPhaseExchange {
				selectCards("exchange", "Обменять выбранные", 0, 1000, 1, 5)
				add("stand", "Без обмена", 0)
			} else {
				add("play", "Играть", 2000)
				add("fold", "Пас", 0)
			}
		}
	case *d.RussianPoker:
		out.Player = cards(v.GetPlayerHand())
		n := 1
		if out.Phase == d.RussianPokerPhaseForceQualify {
			n = 5
		}
		dealer(v.GetDealerHand(), n)
		if !out.Ended {
			switch out.Phase {
			case d.RussianPokerPhaseSelect:
				selectCards("discard", "Отбросить карту", 0, 0, 1, 1)
			case d.RussianPokerPhaseForceQualify:
				add("force", "Обмен карты дилера", 1000)
				add("decline", "Без обмена дилера", 0)
			default:
				add("play", "Играть", 2000)
				add("fold", "Пас", 0)
				if out.Phase == d.RussianPokerPhaseAction {
					selectCards("exchange", "Обменять выбранные", 0, 1000, 1, 5)
					add("buy-sixth", "Купить шестую карту", 1000)
				}
			}
		}
	case *d.CaribbeanDraw:
		out.Player = cards(v.GetPlayerHand())
		dealer(v.GetDealerHand(), 1)
		if !out.Ended {
			if out.Phase == d.CaribbeanDrawPhaseDraw {
				selectCards("draw", "Обменять выбранные", 1000, 0, 1, 2)
				add("stand", "Без обмена", 0)
			} else {
				add("play", "Играть", 2000)
				add("fold", "Пас", 0)
			}
		}
	case *d.ThreeCardRummy:
		out.Player = cards(v.GetPlayerHand())
		dealer(v.GetDealerHand(), 0)
		if !out.Ended {
			add("play", "Играть", 1000)
			add("fold", "Пас", 0)
		}
	case *d.AndarBahar:
		out.Player = cards(one(v.GetJoker()))
		out.Message = "Карта-ориентир. Ставка уже сохранена: выбери сторону."
		if out.Ended {
			out.Hands = []handView{{Cards: cards(v.GetAndarCards()), Label: "Andar"}, {Cards: cards(v.GetBaharCards()), Label: "Bahar"}}
			out.Message = "Найдено совпадение с картой-ориентиром"
		} else {
			a, b := "2×", "1,9×"
			if v.GetFirstColumn() == 0 {
				a, b = b, a
			}
			add("andar", "Andar: выплата "+a, 0)
			add("bahar", "Bahar: выплата "+b, 0)
		}
	case *royalBlackjack:
		addHands(out, v.GetPlayerHands(), v.GetCurrentHandIdx())
		n := 1
		if id == "exposure" {
			n = 2
		}
		dealer(dealerCards(v.GetDealer()), n)
		if !out.Ended {
			if out.Phase == d.BJPhaseInsurance {
				add("insurance", "Страховка", 500)
				add("no-insurance", "Без страховки", 0)
			} else {
				add("hit", "Ещё карту", 0)
				add("stand", "Хватит", 0)
				h := v.GetPlayerHands()[v.GetCurrentHandIdx()]
				if v.DoubleDownBlockReason() == d.BJDoubleDownBlockNone {
					add("double", "Удвоить", h.GetBet())
				}
				if len(v.GetPlayerHands()) < 4 && h.CanSplit() {
					add("split", "Разделить пару", h.GetBet())
				}
				if v.CanSurrenderHand(v.GetCurrentHandIdx()) {
					add("surrender", "Сдаться: вернуть половину", 0)
				}
			}
		}
	case *royalSwitch:
		addHands(out, v.GetHands(), v.GetCurrentHandIdx())
		dealer(dealerCards(v.GetDealer()), 1)
		if !out.Ended {
			if out.Phase == d.BJSwitchPhaseSwitch {
				add("switch", "Поменять вторые карты", 0)
				add("keep", "Оставить карты", 0)
			} else {
				add("hit", "Ещё карту", 0)
				add("stand", "Хватит", 0)
				h := v.GetHands()[v.GetCurrentHandIdx()]
				if h.GetCardsSize() == 2 {
					add("double", "Удвоить руку", h.GetBet())
				}
			}
		}
	case *royalFree:
		addHands(out, v.GetHands(), v.GetActiveHandIdx())
		dealer(v.GetDealerCards(), 1)
		if !out.Ended {
			add("hit", "Ещё карту", 0)
			add("stand", "Хватит", 0)
			if v.CanFreeDouble() {
				add("free-double", "Бесплатно удвоить", 0)
			}
			if v.CanFreeSplit() {
				add("free-split", "Бесплатно разделить", 0)
			}
		}
	}
}

func dealerCards(p *d.BlackJackPlayer) []*d.Card {
	out := []*d.Card{}
	for i := 0; i < p.GetCardsSize(); i++ {
		out = append(out, p.GetCard(i))
	}
	return out
}
