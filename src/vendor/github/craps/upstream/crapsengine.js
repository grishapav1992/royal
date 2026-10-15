/**
 * Craps Engine v0.1.0
 * Copyright (c) 2017 wschmrdr
 */

(function() {
  'use strict';

  // All the valid points for this game.
  // Games with different points have significantly different rules.
  var validPoints = [4, 5, 6, 8, 9, 10];

  // Throw this error when a player attempts to make a bet that is below the minimum.
  function GameMinimumError(message) {
    this.name = 'GameMinimumError';
    this.message = (message || "");
  }
  GameMinimumError.prototype = Error.prototype;

  // Throw this error when a player attempts to make a bet that is above the maximum.
  function GameMaximumError(message) {
    this.name = 'GameMaximumError';
    this.message = (message || "");
  }
  GameMaximumError.prototype = Error.prototype;

  // Throw this error when a player attempts to make an odds bet beyond the maximum without main pressure.
  function GameOddsMaximumError(message) {
    this.name = 'GameOddsMaximumError';
    this.message = (message || "");
  }
  GameOddsMaximumError.prototype = Error.prototype;

  // Throw this error when a player attempts to make a bet that isn't allowed.
  function GameBetNotAllowedError(message) {
    this.name = 'GameBetNotAllowedError';
    this.message = (message || "");
  }
  GameBetNotAllowedError.prototype = Error.prototype;

  /**
   * Game class that defines a single table, or 'game'.
   */
  class Game {
    /*
     * Create the Game instance. This should only ever be called when a game is first starting.
     * It should only be abandoned or destructed after a "seven out".
     * @param lowLimit [Number] Minimum for a "non-center" bet. All center bets are minimum 1. Default: 5
     * @param highLimit [Number] Maximum across all bets for a player based on positive bet. Defualt: 10000
     * @param highCenter [Number] Maximum across all "center" bets. Default: 100
     * @param maxOdds [Number] Maximum multiple of odds on a positive pass or come. Default: -2
     * @param vigOnBet [Boolean] For Buy and Lay bets, do we collect the commission on the bet?
     * @see Game#getGameOddsRatio for info on special negative values.
     * @note Maximums for "losing" non-contract bets are based from the proceeds from a roll of 7.
     */
    constructor(lowLimit, highLimit, highCenter, maxOdds, vigOnBet) {
      this.lowLimit = lowLimit || 5;
      this.highLimit = highLimit || 10000;
      this.highCenter = highCenter || 100;
      this.maxOdds = (typeof(maxOdds) === 'number') ? maxOdds : -2;
      this.vigOnBet = vigOnBet || false;
      this.playerBets = [];
      this.pointValue = 0;
    }

    /* 
     * Validate the bet is appropriate for the game, and add it to the array of player bets for this game.
     * @param playerBet [PlayerBet] The bet a player wishes to make.
     * @param canPressMain [Boolean] If odds exceed the maximum, is it acceptable to press the main bet?
     * @return [PlayerBet] The bet that has been added or pressured.
     * @throws [GameOddsMaximumError] The maximum odds for this bet is exceeded, and the main bet will not be pressed.
     * @throws [GameBetNotAllowedError] The bet cannot be made at this time.
     */
    makeBet(playerBet, canPressMain) {
      // First make sure the bet is allowed and, if necessary, a proper point is set.
      if (this.pointValue && playerBet['bet']['useGamePoint']) {
        // If the point is established, always put the point on the Line and Don't.
        // If there's already a Line/Don't bet, it will be pressed later.
        // If there isn't, it is a "Put" bet, which may be checked later.
        playerBet['bet'].pointMarked(this.pointValue);
      } else if (!this.pointValue && playerBet['bet']['useGamePoint']) {
        // If no point is established, always cancel the point on the Line and Don't.
        // If there's already a Line/Don't bet, it will be pressed later.
        playerBet['bet'].pointMarked(0);
      } else if (!this.pointValue && playerBet['bet']['hasPoint'] && !playerBet['bet']['useGamePoint'] &&
                 !playerBet['bet']['pointValue']) {
        throw new GameBetNotAllowedError("Cannot make a new Come or Dont Bet when there is no point. Use the line.");
      }


      // Find if this bet has already been made, and if so, determine if we can "press" it.
      var betPressed = this.getBetsById(playerBet['pid']).find(function(bet) {
        return bet['bet'].constructor === playerBet['bet'].constructor &&
               bet['bet']['name'] === playerBet['bet']['name'] &&
               bet['bet']['pointValue'] === playerBet['bet']['pointValue'];
      });
      if (betPressed) {
        // "Pressure" on the main bet is not allowed for the Don't Pass and DC.
        if (playerBet['bet']['hasPoint'] && playerBet['bet']['isLose'] &&
            playerBet['bet']['pointValue'] && playerBet['amount'] > 0) {
          throw new GameBetNotAllowedError("Cannot Put a Dont bet with a point.");
        }
        this.validateMinimum(playerBet, betPressed);
        var betMaxOdds = this.getGameOddsRatio(betPressed['bet']);
        var oddsTotal = betPressed['oddsAmount'] + playerBet['oddsAmount'];
        var baseTotal = betPressed['amount'] + playerBet['amount'];
        var newVigTotal = betPressed['preVigAmount'] + playerBet['amount'];
        if (oddsTotal > (baseTotal * betMaxOdds)) {
          if (!canPressMain) {
            throw new GameOddsMaximumError("Odds exceed the maximum, and the main bet cannot be pressed.");
          }
          if ((betMaxOdds + 1) === 0) {
            var newBaseTotal = baseTotal + betPressed['oddsAmount'];
            var newOddsTotal = playerBet['oddsAmount'];
          } else {
            var newBaseTotal = baseTotal + Math.ceil((oddsTotal - (baseTotal * betMaxOdds)) / (betMaxOdds + 1));
            var newOddsTotal = oddsTotal - (newBaseTotal - baseTotal);
            newVigTotal += (newBaseTotal - baseTotal);
          }
          // Now we must re-check the maximum and main pressure on a don't.
          if (playerBet['bet']['isLose'] && playerBet['bet']['hasPoint'] &&
              playerBet['bet']['pointValue'] && newBaseTotal > betPressed['amount']) {
            throw new GameBetNotAllowedError("Cannot Press a Main Dont Bet with a Point.");
          }
          if (playerBet['bet']['hasVig'] && this.vigOnBet) {
            var vig = Math.floor(new PlayerBet(betPressed['pid'], betPressed['bet'], newVigTotal).getBetAction()
                      / 20) || 1;
            newBaseTotal = newVigTotal - vig;
          }
          this.validateMaximum(new PlayerBet(betPressed['pid'], betPressed['bet'], newBaseTotal, newOddsTotal),
                               betPressed);
          betPressed['amount'] = newBaseTotal;
          betPressed['oddsAmount'] = newOddsTotal;
          betPressed['preVigAmount'] = newVigTotal;
        } else {
          if (playerBet['bet']['hasVig'] && this.vigOnBet) {
            var vig = Math.floor(new PlayerBet(betPressed['pid'], betPressed['bet'], newVigTotal).getBetAction()
                      / 20) || 1;
            baseTotal = newVigTotal - vig;
          }
          this.validateMaximum(new PlayerBet(betPressed['pid'], betPressed['bet'], baseTotal, oddsTotal),
                               betPressed);
          betPressed['amount'] = baseTotal;
          betPressed['oddsAmount'] = oddsTotal;
          betPressed['preVigAmount'] = newVigTotal;
        }
        return betPressed;
      } else {
        // "Put" bets are not allowed for the Don't Pass and DC.
        if (playerBet['bet']['hasPoint'] && playerBet['bet']['isLose'] && playerBet['bet']['pointValue']) {
          throw new GameBetNotAllowedError("Cannot Put a Dont bet with a point.");
        }
        this.validateMinimum(playerBet);
        var betMaxOdds = this.getGameOddsRatio(playerBet['bet']);
        var oddsTotal = playerBet['oddsAmount'];
        var baseTotal = playerBet['amount'];
        if (oddsTotal > (baseTotal * betMaxOdds)) {
          if (!canPressMain) {
            throw new GameOddsMaximumError("Odds exceed the maximum, and the main bet cannot be pressed.");
          }
          if ((betMaxOdds + 1) === 0) {
            var newBaseTotal = baseTotal + oddsTotal;
            var newOddsTotal = 0;
          } else {
            var newBaseTotal = baseTotal + Math.ceil((oddsTotal - (baseTotal * betMaxOdds)) / (betMaxOdds + 1));
            var newOddsTotal = oddsTotal - (newBaseTotal - baseTotal);
          }
          if (playerBet['bet']['hasVig'] && this.vigOnBet) {
            var vig = Math.floor(new PlayerBet(playerBet['pid'], playerBet['bet'], newBaseTotal).getBetAction()
                      / 20) || 1;
            playerBet['preVigAmount'] = newBaseTotal;
            newBaseTotal -= vig;
          }
          this.validateMaximum(new PlayerBet(playerBet['pid'], playerBet['bet'], newBaseTotal, newOddsTotal),
                               playerBet);
          playerBet['amount'] = newBaseTotal;
          playerBet['oddsAmount'] = newOddsTotal;
        } else if (playerBet['bet']['hasVig'] && this.vigOnBet) {
          var vig = Math.floor(new PlayerBet(playerBet['pid'], playerBet['bet'], baseTotal).getBetAction()
                    / 20) || 1;
          baseTotal -= vig;
          this.validateMaximum(new PlayerBet(playerBet['pid'], playerBet['bet'], baseTotal, oddsTotal),
                               playerBet);
          playerBet['preVigAmount'] = playerBet['amount'];
          playerBet['amount'] = baseTotal;
          playerBet['oddsAmount'] = oddsTotal;
        } else {
          this.validateMaximum(playerBet);
        }
        this.playerBets.push(playerBet);
      }
      return playerBet;
    }

    /*
     * Find an active bet made by the player on this game.
     * @param playerBet [PlayerBet] A simple instance containing the player ID and bet with pointValue.
     * @return [PlayerBet] The PlayerBet instance in the game, if found.
     */
    findBet(playerBet) {
      return this.getBetsById(playerBet['pid']).find(function(bet) {
        return bet['bet'].constructor === playerBet['bet'].constructor &&
               bet['bet']['name'] === playerBet['bet']['name'] &&
               bet['bet'].pointValue === playerBet['bet'].pointValue;
      });
    }
    
    /*
     * Verify the minimum wager amount for the table is covered.
     * @param playerBet [PlayerBet] The bet a player wishes to make.
     * @param pressedBet [PlayerBet] A bet of this type and point already found where pressure could be added.
     * @return [Number] The value of the action for the bet.
     * @throws [GameMinimumError] The table minimum is not met.
     */
    validateMinimum(playerBet, pressedBet) {
      var mainAction = playerBet.getBetAction();
      var pressAction = 0;
      if (pressedBet) {
        pressAction = pressedBet.getBetAction();
      }
      if (playerBet['bet']['isCenter'] && (mainAction + pressAction) < 1) {
        throw new GameMinimumError("The main bet does not cover the minimum for center action.");
      } else if (!playerBet['bet']['isCenter'] && (mainAction + pressAction) < this.lowLimit) {
        throw new GameMinimumError("The main bet does not cover the table minimum.");
      }
      return mainAction + pressAction;
    }

    /*
     * Verify the maximum wager amount for the table is not exceeded.
     * @param playerBet [PlayerBet] The bet a player wishes to make.
     * @param exception [PlayerBet] A bet to not count in the maximum.
     * @return [Number] The value of the action for the bet.
     * @throws [GameMaximumError] The table maximum is exceeded.
     */
    validateMaximum(playerBet, exception) {
      var mainAction = playerBet.getBetAction();
      if (mainAction + this.getPlayerActionById(playerBet['pid'], false, exception) > this.highLimit) {
        throw new GameMaximumError("Your table action exceeds the maximum.");
      } else if (playerBet['bet']['isCenter'] && (mainAction +
                 this.getPlayerActionById(playerBet['pid'], true, exception) > this.highCenter)) {
        throw new GameMaximumError("Your center action exceeds the maximum.");
      }
      return mainAction + this.getPlayerActionById(playerBet['pid'], false, exception);
    }

    /*
     * Once the dice have been "rolled", evaluate the game according to the roll.
     * @param roll [DiceRoll] The combination that was rolled.
     * @param callback [Function] Function to perform additional processing based on the bet and pay.
     */
    rollComplete(roll, callback) {
      // Generally, in order to "shoot", a player must have a line bet on the table.
      // There must be at least one Pass or Don't Pass bet on the table to roll.
      if (!this.playerBets.find(function(bet) {
        return bet['bet']['hasPoint'] && bet['bet']['useGamePoint'];
      })) {
        if (callback != null) {
          callback(null, 0);
        }
        return;
      }
      // First, take or pay the bets that resolve with this roll.
      var unresolvedBets = [];
      for (var x=0; x<this.playerBets.length; x++) {
        var pay = this.playerBets[x]['bet'].evaluateRoll(this, this.playerBets[x], roll);
        if (typeof(pay) !== 'number') {
          // Pay is only a number if the bet is resolved. Keep the bet.
          unresolvedBets.push(this.playerBets[x]);
        } else if (callback != null) {
          callback(this.playerBets[x], pay);
        }
      }

      // Next, mark the point for the game if it needs to be marked.
      if (roll.rollValue() === 7 || roll.rollValue() === this.pointValue) {
        // The game either came back on the point or made a "seven out", so the point is done.
        this.pointValue = 0;
      } else if (!this.pointValue) {
        this.pointValue = roll.isValidPoint() || 0;
      }

      // Then, for all contract bets without a point, mark them if we rolled a valid point.
      // Even if we hit the main point, the "Don'ts and Comes" still need a point.
      for (x=0; x<unresolvedBets.length; x++) {
        if (roll.isValidPoint() && unresolvedBets[x]['bet']['hasPoint'] && !unresolvedBets[x]['bet']['pointValue']) {
          unresolvedBets[x]['bet'].pointMarked(roll.rollValue());
        }
      }

      // Finally, reset the playerBets.
      this.playerBets = unresolvedBets;
    }

    /*
     * Find all bets a player has in this game.
     * @param pid [Number] The identifier for the player.
     * @return [Array<PlayerBet>] All active bets for the player.
     */
    getBetsById(pid) {
      return this.playerBets.filter(function(bet) {
        return pid === bet['pid'];
      });
    }

    /*
     * Determine how much is actively wagered by a player in this game.
     * @param pid [Number] The identifier for the player.
     * @param centerOnly [Boolean] Should we only consider center bets?
     * @param exception [PlayerBet] If this bet is found, do not add it to the total.
     * @return [Number] The amount actively wagered.
     * @see PlayerBet#getBetAction
     */
    getPlayerActionById(pid, centerOnly, exception) {
      return this.getBetsById(pid).reduce(function(total, bet) {
        if (exception && bet['bet'].constructor === exception['bet'].constructor &&
            bet['bet']['name'] === exception['bet']['name'] &&
            bet['bet']['pointValue'] === exception['bet']['pointValue']) {
          return total;
        }
        if (centerOnly && bet['bet']['isCenter']) {
          return total + bet.getBetAction();
        }
        if (!centerOnly) {
          return total + bet.getBetAction();
        }
        return total;
      }, 0);
    }

    /*
     * Get the maximum number of odds that are allowed on a particular bet.
     * In order to be non-zero, the bet must have a point to be set by roll, and the bet must have a point.
     * @param bet [BaseBet] The specific bet for which we want the odds. The amount can vary by point.
     * @return [Number] The amount of odds that are allowed for a bet.
     * @note The maximum odds for a losing bet is based on the winnings from a "seven out". 
     * @note There are two special odds formulas found in many casinos that have been included here:
     * @note -1 = Full Double Odds: 2.5x on the 6/8, 2x on the 4/5/9/10. Helps to avoid white chips on a $10 main.
     * @note -2 = 3/4/5 (the most common): 3x on the 4/10, 4x on the 5/9, 5x on the 6/8; 6x for all dont bets.
     */
    getGameOddsRatio(bet) {
      // In order to qualify for game odds, the bet must set a point. This is determined with "hasPoint".
      if (!bet['hasPoint']) {
        return 0;
      }
      var retRatio = 0;
      if (this.maxOdds === -1) { // Full Double Odds
        switch (bet['pointValue']) {
          case 4:
          case 5:
          case 9:
          case 10:
            retRatio = 2;
            break;
          case 6:
          case 8:
            retRatio = 2.5;
            break;
          default:
            retRatio = 0;
        }
      } else if (this.maxOdds === -2) { // 3-4-5 Odds
        switch (bet['pointValue']) {
          case 4:
          case 10:
            retRatio = 3;
            break;
          case 5:
          case 9:
            retRatio = 4;
            break;
          case 6:
          case 8:
            retRatio = 5;
            break;
          default:
            retRatio = 0;
        }
      } else { // A straight number of odds, so apply if there's a point.
        for (var x=0; x<validPoints.length; x++) {
          if (bet['pointValue'] === validPoints[x]) {
            retRatio = this.maxOdds;
          }
        }
      }
      if (bet['isLose'] && bet.getBetOddsRatio() !== 0) {
        retRatio /= bet.getBetOddsRatio();
      }
      return retRatio;
    }
  }

  /** 
   * PlayerBet class that defines a player's single wager.
   */
  class PlayerBet {
    /*
     * Make an initial bet. This will later be validated by the Game before being added to its bets.
     * @param pid [Number] A unique identifier to the specific player. A player may have many bets.
     * @param bet [BaseBet] The bet that is being requested.
     * @param amount [Number] How much the player is wagering on the corresponding bet.
     * @param oddsAmount [Number] How much the player is wagering for odds on the bet.
     */
    constructor(pid, bet, amount, oddsAmount) {
      this.pid = pid; // A key reference to a player.
      this.bet = bet; // An instance of the BaseBet class pertaining to the bet made.
      this.amount = amount; // How much is being wagered for this bet.
      this.oddsAmount = oddsAmount || 0;
      this.preVigAmount = amount;
      this.override = null; // Are we overriding this? true = always on, false = always off, null = default
    }

    /*
     * Set the override value on this bet.
     * @param override [Boolean] Should this bet (or its odds for a contract bet) be always on/off?
     */
    setOverride(override) {
      this.override = override;
    }

    /*
     * Return the override value on this bet to its default action.
     */
    setNormalAction() {
      this.setOverride(null);
    }

    /*
     * Determine how much this bet is worth for the purposes of maximums and commissions.
     * Positive bets are based on the amount bet.
     * Negative odds and non-contract bets are based on the amount to win.
     * @return [Number] The amount of "action" for this bet.
     */
    getBetAction() {
      var total = 0;
      if (this.bet['isLose']) {
        if (this.bet['hasPoint']) {
          // For "contract" bets to lose, the normal amount is used for the base.
          total += this['amount'];
          if (this.bet['pointValue']) {
            // Odds on bets to lose are based on the winning amount, not the amount laid.
            total += (this['oddsAmount'] * this.bet.getBetOddsRatio());
          }
        } else {
          // Non-"contract" bets to lose are based on the winning amount, not the amount laid.
          total += (this['amount'] * this.bet.getBetOddsRatio());
        }
      } else {
        total += this['amount'];
        if (this.bet['hasPoint'] && this.bet['pointValue']) {
          total += this['oddsAmount'];
        }
      }
      return total;
    }
  }

  // Throw this error when the value on a die is improper.
  function DieValueError(message) {
    this.name = 'DieValueError';
    this.message = (message || "");
  }
  DieValueError.prototype = Error.prototype;

  /**
   * Base DiceRoll class that defines a roll of the dice.
   */
  class DiceRoll {
    /*
     * Create a combination of two dice, ordered high to low.
     * @param die1 [Number] The first die value, from 1 to 6.
     * @param die2 [Number] The second die value, from 1 to 6.
     * @throws [DieValueError] The value on a die is improper.
     */
    constructor(die1, die2) {
      if (parseInt(die1) !== die1 || die1 < 1 || die1 > 6) {
        throw new DieValueError('The first die is not a valid value.');
      } else if (parseInt(die2) !== die2 || die2 < 1 || die2 > 6) {
        throw new DieValueError('The second die is not a valid value.');
      }
      if (die2 > die1) {
        this.die1 = parseInt(die2);
        this.die2 = parseInt(die1);
      } else {
        this.die1 = parseInt(die1);
        this.die2 = parseInt(die2);
      }
    }

    /*
     * Get the sum of the two dice for the roll value.
     * @return [Number] The sum of the value of die 1 and die 2.
     */
    rollValue() {
      return this.die1 + this.die2;
    }

    /*
     * Output the roll as a string based on the value of the roll.
     * Some craps lingo is introduced based on rhyming values and basic rules of the game.
     * @return [String] The roll of the dice in a word format.
     */
    toString() {
      var value = this.rollValue();
      var rollString = '';
      switch (value) {
        case 2:
        case 3:
        case 12:
          rollString = value.toString() + " is Craps";
          break;
        case 11:
          rollString = value.toString() + " Yo";
          break;
        case 9:
          rollString = value.toString() + " Center Field";
          break;
        case 5:
          rollString = value.toString() + " No Field";
          break;
        case 4:
        case 6:
        case 8:
        case 10:
          if (this.die1 === this.die2) {
            rollString = value.toString() + " the Hardway";
          } else {
            rollString = value.toString() + " came Easy";
          }
          break;
        case 7:
          rollString = value.toString();
          break;
        default:
          rollString = "No roll";
      }
      return rollString;
    }

    /*
     * Determine if the roll of the dice is a valid point.
     * @return [Number] The value of the roll if it is valid, or 0 if it is not.
     */
    isValidPoint() {
      for (var x=0; x<validPoints.length; x++) {
        if (this.rollValue() === validPoints[x]) {
          return this.rollValue();
        }
      }
      return 0;
    }

    /*
     * Determine if these dice are equal to another dice roll.
     * For these purposes, the roll value does not necessarily mean equality, but rather each die.
     * @param comp [DiceRoll] Another roll of the dice being compared.
     * @return [Boolean] Are the dice rolls equal.
     */
    isEqual(comp) {
      return this.die1 === comp.die1 && this.die2 === comp.die2;
    }

    /*
     * Get all possible dice rolls based on a given value.
     * @param value [Number or Array<Number>] The value or values to get.
     * @param exceptRoll [DiceRoll] A single exception to leave out of the return. Useful for hardways.
     * @return [Array<DiceRoll>] All possible roll combinations for the value, minus the exception.
     */
    static getRolls(value, exceptRoll) {
      value = (Array.isArray(value)) ? value : [value];
      var retRolls = [];
      for (var x=0; x<value.length; x++) {
        switch (value[x]) {
          case 2:
            retRolls.push(new DiceRoll(1, 1));
            break;
          case 3:
            retRolls.push(new DiceRoll(2, 1));
            break;
          case 4:
            retRolls = retRolls.concat([new DiceRoll(3, 1), new DiceRoll(2, 2)]);
            break;
          case 5:
            retRolls = retRolls.concat([new DiceRoll(4, 1), new DiceRoll(3, 2)]);
            break;
          case 6:
            retRolls = retRolls.concat([new DiceRoll(5, 1), new DiceRoll(4, 2), new DiceRoll(3, 3)]);
            break;
          case 7:
            retRolls = retRolls.concat([new DiceRoll(6, 1), new DiceRoll(5, 2), new DiceRoll(4, 3)]);
            break;
          case 8:
            retRolls = retRolls.concat([new DiceRoll(6, 2), new DiceRoll(5, 3), new DiceRoll(4, 4)]);
            break;
          case 9:
            retRolls = retRolls.concat([new DiceRoll(6, 3), new DiceRoll(5, 4)]);
            break;
          case 10:
            retRolls = retRolls.concat([new DiceRoll(6, 4), new DiceRoll(5, 5)]);
            break;
          case 11:
            retRolls.push(new DiceRoll(6, 5));
            break;
          case 12:
            retRolls.push(new DiceRoll(6, 6));
            break;
        }
      }
      if (exceptRoll) {
        var indexExcept = retRolls.findIndex(function(currValue) {return currValue.isEqual(exceptRoll);});
        if (indexExcept >= 0) {
          retRolls.splice(indexExcept, 1);
        }
      }
      return retRolls;
    }
  }

  // Throw this error when the point being set for a bet is improper.
  function BetInvalidPointError(message) {
    this.name = 'BetInvalidPointError';
    this.message = (message || "");
  }
  BetInvalidPointError.prototype = Error.prototype;

  /**
   * Base Bet class that facilitates and resolves bets.
   */
  class BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * This should only be used as a super call, or for a custom bet.
     * @param params [Object] All the parameters needed for the bet according to options.
     * @option params name [String] The name of the bet.
     * @option params hasPoint [Boolean] Can this bet have a point established for it?
     * @note If and only if the bet can have a point, it is a "contract" bet.
     * @note All bets with hasPoint allow for odds to be placed.
     * @note All odds are not "contract", and may be pulled at any time.
     * @option params useGamePoint [Boolean] Is the point always to be equal to the game's pointValue?
     * @option params pointValue [Number] The current "point" for this bet.
     * @note It is permissible to make a point bet after the point is established.
     * @note The point will also be used for place, buy, and lay bets.
     * @option params overrideComeOut [Boolean] Is this bet active on the 'come out roll'?
     * @option params isLose [Boolean] Is this bet a "Don't" bet that wins on a 'seven out'?
     * @option params isCenter [Boolean] Is this bet part of the 'center of the table' subject to lower limits?
     * @option params hasVig [Boolean] Does this bet charge a 5% commission?
     * @option params resolves [Array<Object(Array<DiceRoll>, Number)>] The rolls and pays that resolve this bet.
     * @option params pointMarked [function(pointValue[, resolves, pointResolves])] A custom function to set the point on a bet.
     * @option params evaluateRoll [function(table, playerBet, roll)] A custom function to determine if the bet is resolved.
     */
    constructor(params) {
      params = (typeof(params) === 'object') ? params : {};
      this.name = params['name'] || 'Bet';
      this.hasPoint = params['hasPoint'] || false;
      this.useGamePoint = params['useGamePoint'] || false;
      this.pointValue = params['pointValue'] || 0;
      this.overrideComeOut = params['overrideComeOut'] || false;
      this.isLose = params['isLose'] || false;
      this.isCenter = params['isCenter'] || false;
      this.hasVig = params['hasVig'] || false;
      this.resolves = params['resolves'] || [];
      if (typeof(params['pointMarked']) === 'function') {
        this.pointMarked = params['pointMarked'];
      }
      if (typeof(params['evaluateRoll']) === 'function') {
        this.evaluateRoll = params['evaluateRoll'];
      }
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @param resolves [Array<Object(Array<DiceRoll>, Number)>] The general rolls and pays resolving this bet.
     * @param pointResolves [Array<Object(Array<DiceRoll>, Number)>] Alternate rolls and pays on a point.
     */
    pointMarked(pointValue, resolves, pointResolves) {
      // If we already have a point established, do not reset it.
      if (pointValue && this.pointValue) {
        return;
      }
      this.pointValue = pointValue;
      if (this.hasPoint && pointValue) {
        this.resolves = pointResolves || resolves || [];
      } else {
        this.resolves = resolves || [];
      }
    }

    /**
     * Determine the outcome for a particular bet.
     * @param table [Game] The present game being played.
     * @param playerBet [PlayerBet] The bet that is being evaluated.
     * @param roll [DiceRoll] On what roll value the bet is being evaluated.
     * @return [Number] The amount paid in addition to a 'returned bet', or null if the bet is still active.
     */
    evaluateRoll(table, playerBet, roll) {
      // Determine the override values on this bet.
      // On the "come out roll", the bet is according to overrideComeOut.
      // Odds on the "come out roll" for positive bets are off, negative bets are on.
      var override = this.overrideComeOut;
      var oddsOverride = this.isLose;
      // Now set the overrides based on player wishes and current game standing.
      if (this.hasPoint) {
        // This is a contract bet, and only the odds can be turned off.
        override = true;
        if (playerBet['override'] === true || playerBet['override'] === false) {
          oddsOverride = override;
        } else if (table['pointValue']) {
          oddsOverride = true;
        }
      } else if (playerBet['override'] === true || playerBet['override'] === false) {
        // The player has specifically requested a bet be always on or always off.
        override = playerBet['override'];
      } else if (table['pointValue']) {
        // A point is established; the bet is on.
        override = true;
      }
      for (var x=0; x<this.resolves.length; x++) {
        if (this.resolves[x]['rolls'].find(function(resRoll) { return resRoll.isEqual(roll); })) {
          var retPay = override ? Math.floor(this.resolves[x]['pay'] * playerBet['amount']) : 0;
          if (retPay > 0 && this['hasVig'] && !table['vigOnBet']) {
            // The 5% Commission is only ever paid on a win, and only on the main bet.
            if (this['isLose']) {
              // The 5% Commission is based from the win.
              var vig = Math.floor(retPay / 20) || 1;
            } else {
              // The 5% Commission is based from the bet.
              var vig = Math.floor(playerBet['amount'] / 20) || 1;
            }
            retPay -= vig;
          }
          if (this.resolves[x]['pay'] >= 0 && playerBet['oddsAmount'] > 0) {
            // Get the odds ratio for the original point before paying it.
            retPay += oddsOverride ? Math.floor(this.getBetOddsRatio() * playerBet['oddsAmount']) : 0;
          } else if (this.resolves[x]['pay'] < 0 && playerBet['oddsAmount'] > 0) {
            retPay += oddsOverride ? Math.floor(this.resolves[x]['pay'] * playerBet['oddsAmount']) : 0;
          }
          return retPay;
        }
      }
      return null;
    }

    /*
     * Get the pay ratio based on statistically fair odds bet on this bet.
     * The odds depend on the roll permutations of the point vs. a 7.
     * @note The ratios are inversed for a lose bet because the 7 is a winning roll.
     * @return [Number] The statistically fair pay ratio for the roll.
     */
    getBetOddsRatio() {
      var oddsRatio = 0;
      switch(this.pointValue) {
        case 4:
        case 10:
          oddsRatio = 6/3;
          break;
        case 5:
        case 9:
          oddsRatio = 6/4;
          break;
        case 6:
        case 8:
          oddsRatio = 6/5;
          break;
        default:
          oddsRatio = 0;
      }
      if (this.isLose && oddsRatio !== 0) {
        oddsRatio = 1/oddsRatio;
      }
      return oddsRatio;
    }
  }

  /**
   * Bet class that facilitates the base Pass Line and Come bets.
   * @extend BaseBet
   */
  class LineComeBet extends BaseBet {
    /**
     * Create the bet instance and set the point, if any. This is usually attached to a PlayerBet.
     * This should only be used as a super call. The rules for Pass Line and Come are exactly the same.
     * @param params [Object] All the parameters needed for the bet according to options.
     * @option params name [String] The name of the bet.
     * @option params useGamePoint [Boolean] Is the point always to be equal to the game's pointValue?
     * @option params pointValue [Number] The current point for this bet.
     */
    constructor(params) {
      // Initially set the point to 0 so it can be marked.
      params = (typeof(params) === 'object') ? params : {};
      var pointValue = params['pointValue'];
      params['pointValue'] = 0;
      params['hasPoint'] = true;
      params['overrideComeOut'] = true;
      super(params);
      this.pointMarked(pointValue); // The bet could be made "late", so account for this.
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @throw [BetInvalidPointError] This point cannot be set for this bet.
     * @note winners for resolves are any combination of 7 or 11 for even money.
     * @note losers for resolves are any combination of 2, 3, or 12.
     * @note winners for pointResolves are any combination of pointValue for even money.
     * @note losers for pointResolves are any combination of 7.
     */
    pointMarked(pointValue) {
      var validPointFound = false;
      for (var x=0; x<validPoints.length; x++) {
        validPointFound = (pointValue === validPoints[x]) || validPointFound;
      }
      if (pointValue && !validPointFound) {
        throw new BetInvalidPointError("This point cannot be set for this bet.");
      }
      var pointResolves = [
        {
          'rolls': DiceRoll.getRolls(pointValue),
          'pay': 1
        },
        {
          'rolls': DiceRoll.getRolls(7),
          'pay': -1
        }
      ];
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([7, 11]),
          'pay': 1
        },
        {
          'rolls': DiceRoll.getRolls([2, 3, 12]),
          'pay': -1
        }
      ];
      super.pointMarked(pointValue, resolves, pointResolves);
    }
  }

  /**
   * Bet class that facilitates the base Don't Pass Line and Don't Come bets.
   * @extend BaseBet
   */
  class DontLineComeBet extends BaseBet {
    /**
     * Create the bet instance and set the point, if any. This is usually attached to a PlayerBet.
     * This should only be used as a super call. The rules for Pass Line and Come are exactly the same.
     * @param params [Object] All the parameters needed for the bet according to options.
     * @option params name [String] The name of the bet.
     * @option params useGamePoint [Boolean] Is the point always to be equal to the game's pointValue?
     * @option params pointValue [Number] The current point for this bet.
     */
    constructor(params) {
      params = (typeof(params) === 'object') ? params : {};
      var pointValue = params['pointValue'];
      params['pointValue'] = 0;
      params['hasPoint'] = true;
      params['overrideComeOut'] = true;
      params['isLose'] = true;
      // Initially set the point to 0 so it can be marked.
      super(params);
      this.pointMarked(pointValue); // The bet could be made "late", so account for this.
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @throw [BetInvalidPointError] This point cannot be set for this bet.
     * @note winners for resolves are any combination of 2 or 3 for even money.
     * @note pushes for resolves are a 12.
     * @note losers for resolves are any combination of 7 or 11.
     * @note winners for pointResolves are any combination of 7 for even money.
     * @note losers for pointResolves are any combination of pointValue.
     */
    pointMarked(pointValue) {
      var validPointFound = false;
      for (var x=0; x<validPoints.length; x++) {
        validPointFound = (pointValue === validPoints[x]) || validPointFound;
      }
      if (pointValue && !validPointFound) {
        throw new BetInvalidPointError("This point cannot be set for this bet.");
      }
      var pointResolves = [
        {
          'rolls': DiceRoll.getRolls(pointValue),
          'pay': -1
        },
        {
          'rolls': DiceRoll.getRolls(7),
          'pay': 1
        }
      ];
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([7, 11]),
          'pay': -1
        },
        {
          'rolls': DiceRoll.getRolls([2, 3]),
          'pay': 1
        },
        {
          'rolls': DiceRoll.getRolls(12),
          'pay': 0
        }
      ];
      super.pointMarked(pointValue, resolves, pointResolves);
    }
  }

  /**
   * Bet class that facilitates the Pass Line bet.
   * @extend LineComeBet
   */
  class PassLineBet extends LineComeBet {
    /**
     * Create the bet instance and set the point, if any. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet.
     */
    constructor(pointValue) {
      var params = {
        'name': 'Pass Line',
        'useGamePoint': true,
        'pointValue': pointValue
      };
      super(params);
    }
  }

  /**
   * Bet class that facilitates the Don't Pass Line bet.
   * @extend DontLineComeBet
   */
  class DontPassLineBet extends DontLineComeBet {
    /**
     * Create the bet instance and set the point, if any. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet.
     */
    constructor(pointValue) {
      var params = {
        'name': 'Dont Pass Line',
        'useGamePoint': true,
        'pointValue': pointValue
      };
      super(params);
    }
  }

  /**
   * Bet class that facilitates the Come bet.
   * @extend LineComeBet
   */
  class ComeBet extends LineComeBet {
    /**
     * Create the bet instance and set the point, if any. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet.
     */
    constructor(pointValue) {
      var params = {
        'name': 'Come',
        'pointValue': pointValue
      };
      super(params);
    }
  }

  /**
   * Bet class that facilitates the Don't Come bet.
   * @extend DontLineComeBet
   */
  class DontComeBet extends DontLineComeBet {
    /**
     * Create the bet instance and set the point, if any. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet.
     */
    constructor(pointValue) {
      var params = {
        'name': 'Dont Come',
        'pointValue': pointValue
      };
      super(params);
    }
  }

  /**
   * Bet class that facilitates the Field bet for a normal casino.
   * @note House Advantage: 2.78%
   * @extend BaseBet
   */
  class FieldBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([3, 4, 9, 10, 11]),
          'pay': 1
        },
        {
          'rolls': DiceRoll.getRolls(2),
          'pay': 2
        },
        {
          'rolls': DiceRoll.getRolls(12),
          'pay': 3
        },
        {
          'rolls': DiceRoll.getRolls([5, 6, 7, 8]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Field',
        'overrideComeOut': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Field bet for a stingy casino that pays double on 2 and 12.
   * @note House Advantage: 5.56%
   * @extend BaseBet
   */
  class StingyFieldBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([3, 4, 9, 10, 11]),
          'pay': 1
        },
        {
          'rolls': DiceRoll.getRolls([2, 12]),
          'pay': 2
        },
        {
          'rolls': DiceRoll.getRolls([5, 6, 7, 8]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Field',
        'overrideComeOut': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Big 6 and Big 8 bets.
   * @extend BaseBet
   */
  class BigBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The winning roll for this bet.
     */
    constructor(pointValue) {
      var params = {
        'name': 'Big ' + pointValue,
        'overrideComeOut': true,
      };
      super(params);
      this.pointMarked(pointValue);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @throw [BetInvalidPointError] This point cannot be set for this bet.
     */
    pointMarked(pointValue) {
      var validPointFound = false;
      var betValidPoints = [6, 8];
      for (var x=0; x<betValidPoints.length; x++) {
        validPointFound = (pointValue === betValidPoints[x]) || validPointFound;
      }
      if (!validPointFound) {
        throw new BetInvalidPointError("This point cannot be set for this bet.");
      }
      var resolves = [
        {
          'rolls': DiceRoll.getRolls(pointValue),
          'pay': 1
        },
        {
          'rolls': DiceRoll.getRolls(7),
          'pay': -1
        }
      ];
      var pointResolves = [];
      super.pointMarked(pointValue, resolves, pointResolves);
    }
  }

  /**
   * Bet class that facilitates the Place bet.
   * @extend BaseBet
   */
  class PlaceBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The winning roll for this bet.
     */
    constructor(pointValue) {
      var params = {
        'name': 'Place',
      };
      super(params);
      this.pointMarked(pointValue);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @throw [BetInvalidPointError] This point cannot be set for this bet.
     */
    pointMarked(pointValue) {
      var validPointFound = false;
      for (var x=0; x<validPoints.length; x++) {
        validPointFound = (pointValue === validPoints[x]) || validPointFound;
      }
      if (!validPointFound) {
        throw new BetInvalidPointError("This point cannot be set for this bet.");
      }
      var resolves = [
        {
          'rolls': DiceRoll.getRolls(pointValue),
          'pay': this.getPayRatio(pointValue)
        },
        {
          'rolls': DiceRoll.getRolls(7),
          'pay': -1
        }
      ];
      var pointResolves = [];
      super.pointMarked(pointValue, resolves, pointResolves);
    }

    /*
     * Get the pay ratio on this bet.
     * The odds depend on the roll permutations of the point vs. a 7.
     * @return [Number] The pay ratio for the roll.
     */
    getPayRatio(point) {
      var oddsRatio = 0;
      switch(point) {
        case 4:
        case 10:
          oddsRatio = 9/5;
          break;
        case 5:
        case 9:
          oddsRatio = 7/5;
          break;
        case 6:
        case 8:
          oddsRatio = 7/6;
          break;
        default:
          oddsRatio = 0;
      }
      return oddsRatio;
    }
  }

  /**
   * Bet class that facilitates the Buy bet.
   * @extend BaseBet
   */
  class BuyBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The winning roll for this bet.
     */
    constructor(pointValue) {
      var params = {
        'name': 'Buy',
        'hasVig': true
      };
      super(params);
      this.pointMarked(pointValue);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @throw [BetInvalidPointError] This point cannot be set for this bet.
     */
    pointMarked(pointValue) {
      var validPointFound = false;
      for (var x=0; x<validPoints.length; x++) {
        validPointFound = (pointValue === validPoints[x]) || validPointFound;
      }
      if (!validPointFound) {
        throw new BetInvalidPointError("This point cannot be set for this bet.");
      }
      var resolves = [
        {
          'rolls': DiceRoll.getRolls(pointValue),
          'pay': this.getPayRatio(pointValue)
        },
        {
          'rolls': DiceRoll.getRolls(7),
          'pay': -1
        }
      ];
      var pointResolves = [];
      super.pointMarked(pointValue, resolves, pointResolves);
    }

    /*
     * Get the pay ratio on this bet, which happens to be true odds.
     * The odds depend on the roll permutations of the point vs. a 7.
     * @return [Number] The pay ratio for the roll.
     */
    getPayRatio(point) {
      var oddsRatio = 0;
      switch(point) {
        case 4:
        case 10:
          oddsRatio = 6/3;
          break;
        case 5:
        case 9:
          oddsRatio = 6/4;
          break;
        case 6:
        case 8:
          oddsRatio = 6/5;
          break;
        default:
          oddsRatio = 0;
      }
      return oddsRatio;
    }
  }

  /**
   * Bet class that facilitates the Lay bet.
   * @extend BaseBet
   */
  class LayBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The winning roll for this bet.
     */
    constructor(pointValue) {
      var params = {
        'name': 'Lay',
        'overrideComeOut': true,
        'isLose': true,
        'hasVig': true
      };
      super(params);
      this.pointMarked(pointValue);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @throw [BetInvalidPointError] This point cannot be set for this bet.
     */
    pointMarked(pointValue) {
      var validPointFound = false;
      for (var x=0; x<validPoints.length; x++) {
        validPointFound = (pointValue === validPoints[x]) || validPointFound;
      }
      if (!validPointFound) {
        throw new BetInvalidPointError("This point cannot be set for this bet.");
      }
      var resolves = [
        {
          'rolls': DiceRoll.getRolls(7),
          'pay': this.getPayRatio(pointValue)
        },
        {
          'rolls': DiceRoll.getRolls(pointValue),
          'pay': -1
        }
      ];
      var pointResolves = [];
      super.pointMarked(pointValue, resolves, pointResolves);
    }

    /*
     * Get the pay ratio on this bet, which happens to be true odds.
     * The odds depend on the roll permutations of the point vs. a 7.
     * @return [Number] The pay ratio for the roll.
     */
    getPayRatio(point) {
      var oddsRatio = 0;
      switch(point) {
        case 4:
        case 10:
          oddsRatio = 3/6;
          break;
        case 5:
        case 9:
          oddsRatio = 4/6;
          break;
        case 6:
        case 8:
          oddsRatio = 5/6;
          break;
        default:
          oddsRatio = 0;
      }
      return oddsRatio;
    }
  }

  /**
   * Bet class that facilitates the Hardway bet.
   * @extend BaseBet
   */
  class HardwayBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The winning roll for this bet.
     */
    constructor(pointValue) {
      var params = {
        'name': 'Hard ' + pointValue,
        'isCenter': true
      };
      super(params);
      this.pointMarked(pointValue);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @throw [BetInvalidPointError] This point cannot be set for this bet.
     */
    pointMarked(pointValue) {
      var validPointFound = false;
      var betValidPoints = [4, 6, 8, 10];
      for (var x=0; x<betValidPoints.length; x++) {
        validPointFound = (pointValue === betValidPoints[x]) || validPointFound;
      }
      if (!validPointFound) {
        throw new BetInvalidPointError("This point cannot be set for this bet.");
      }
      var resolves = [
        {
          'rolls': [new DiceRoll(pointValue/2, pointValue/2)],
          'pay': this.getPayRatio(pointValue)
        },
        {
          'rolls': DiceRoll.getRolls([7, pointValue], new DiceRoll(pointValue/2, pointValue/2)),
          'pay': -1
        }
      ];
      var pointResolves = [];
      super.pointMarked(pointValue, resolves, pointResolves);
    }

    /*
     * Get the pay ratio on this bet, which happens to be true odds.
     * The odds depend on the roll permutations of the point vs. a 7.
     * @return [Number] The pay ratio for the roll.
     */
    getPayRatio(point) {
      var ratio = 0;
      switch(point) {
        case 4:
        case 10:
          ratio = 7;
          break;
        case 6:
        case 8:
          ratio = 9;
          break;
        default:
          ratio = 0;
      }
      return ratio;
    }
  }

  /**
   * Bet class that facilitates the Aces Straight bet.
   * @extend BaseBet
   */
  class AcesStraightBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls(2),
          'pay': 30
        },
        {
          'rolls': DiceRoll.getRolls([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Aces',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Twelve Straight bet.
   * @extend BaseBet
   */
  class TwelveStraightBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls(12),
          'pay': 30
        },
        {
          'rolls': DiceRoll.getRolls([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Twelve',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Ace Deuce Straight bet.
   * @extend BaseBet
   */
  class AceDeuceStraightBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls(3),
          'pay': 15
        },
        {
          'rolls': DiceRoll.getRolls([2, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Ace Deuce',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Yo (Eleven) Straight bet.
   * @extend BaseBet
   */
  class YoStraightBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls(11),
          'pay': 15
        },
        {
          'rolls': DiceRoll.getRolls([2, 3, 4, 5, 6, 7, 8, 9, 10, 12]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Yo',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the common Hi Lo split bet.
   * @extend BaseBet
   */
  class HiLoBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([2, 12]),
          // This is split between the 2 and the 12.
          // For a 2 bet, it is 31 for 1 on the number, minus the 2 returned.
          // However, we must do this in terms of 1 since it is a ratio.
          'pay': (29/2) 
        },
        {
          'rolls': DiceRoll.getRolls([3, 4, 5, 6, 7, 8, 9, 10, 11]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Hi Lo',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the common Hi Lo Yo split bet.
   * @extend BaseBet
   */
  class HiLoYoBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([2, 12]),
          // This is split three ways.
          // For a 3 bet, it is 31 for 1 on the number, minus the 3 returned.
          // However, we must do this in terms of 1 since it is a ratio.
          'pay': (28/3)
        },
        {
          'rolls': DiceRoll.getRolls(11),
          // This is split three ways.
          // For a 3 bet, it is 16 for 1 on the number, minus the 3 returned.
          // However, we must do this in terms of 1 since it is a ratio.
          'pay': (13/3) 
        },
        {
          'rolls': DiceRoll.getRolls([3, 4, 5, 6, 7, 8, 9, 10]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Hi Lo Yo',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Any Craps bet.
   * @extend BaseBet
   */
  class AnyCrapsBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([2, 3, 12]),
          'pay': 7
        },
        {
          'rolls': DiceRoll.getRolls([4, 5, 6, 7, 8, 9, 10, 11]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Any Craps',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the C[raps] and E[leven] split bet.
   * @extend BaseBet
   */
  class CAndEBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([2, 3, 12]),
          // On 2, Craps pays 8 for 1, minus the 2 return.
          'pay': (6/2)
        },
        {
          'rolls': DiceRoll.getRolls(11),
          'pay': (14/2)
        },
        {
          'rolls': DiceRoll.getRolls([4, 5, 6, 7, 8, 9, 10]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'C and E',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Horn bet.
   * @extend BaseBet
   */
  class HornBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([2, 12]),
          // On 4, pay 31 for 1, minus the 4 return.
          'pay': (27/4)
        },
        {
          'rolls': DiceRoll.getRolls([3, 11]),
          'pay': (12/4)
        },
        {
          'rolls': DiceRoll.getRolls([4, 5, 6, 7, 8, 9, 10]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Horn',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Horn High Aces bet.
   * @extend BaseBet
   */
  class HornHighAcesBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([2]),
          // High Aces means the Aces bet is doubled. 31-for-1 * 2 - 5 for return.
          'pay': (57/5)
        },
        {
          'rolls': DiceRoll.getRolls([12]),
          'pay': (26/5)
        },
        {
          'rolls': DiceRoll.getRolls([3, 11]),
          'pay': (11/5)
        },
        {
          'rolls': DiceRoll.getRolls([4, 5, 6, 7, 8, 9, 10]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Horn High Aces',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Horn High Twelve bet.
   * @extend BaseBet
   */
  class HornHighTwelveBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([12]),
          // High Twelve means the Twelve bet is doubled. 31-for-1 * 2 - 5 for return.
          'pay': (57/5)
        },
        {
          'rolls': DiceRoll.getRolls([2]),
          'pay': (26/5)
        },
        {
          'rolls': DiceRoll.getRolls([3, 11]),
          'pay': (11/5)
        },
        {
          'rolls': DiceRoll.getRolls([4, 5, 6, 7, 8, 9, 10]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Horn High Twelve',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Horn High Ace Deuce bet.
   * @extend BaseBet
   */
  class HornHighAceDeuceBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([2, 12]),
          'pay': (26/5)
        },
        {
          'rolls': DiceRoll.getRolls([3]),
          // High Ace Deuce doubles the 3. 16 * 2 - 5 for return.
          'pay': (27/5)
        },
        {
          'rolls': DiceRoll.getRolls([11]),
          'pay': (11/5)
        },
        {
          'rolls': DiceRoll.getRolls([4, 5, 6, 7, 8, 9, 10]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Horn High Ace Deuce',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Horn High Yo bet.
   * @extend BaseBet
   */
  class HornHighYoBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([2, 12]),
          'pay': (26/5)
        },
        {
          'rolls': DiceRoll.getRolls([11]),
          // High Yo doubles the 11. 16 * 2 - 5 for return.
          'pay': (27/5)
        },
        {
          'rolls': DiceRoll.getRolls([3]),
          'pay': (11/5)
        },
        {
          'rolls': DiceRoll.getRolls([4, 5, 6, 7, 8, 9, 10]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Horn High Yo',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the Any Seven bet.
   * @extend BaseBet
   */
  class AnySevenBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls(7),
          'pay': 4
        },
        {
          'rolls': DiceRoll.getRolls([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'Any Seven',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  /**
   * Bet class that facilitates the World bet, sometimes also known as Whirl.
   * @extend BaseBet
   */
  class WorldBet extends BaseBet {
    /**
     * Create the bet instance. This is usually attached to a PlayerBet.
     * @param pointValue [Number] The current point for this bet. Does not apply to this bet.
     */
    constructor(pointValue) {
      var resolves = [
        {
          'rolls': DiceRoll.getRolls([2, 12]),
          'pay': (26/5)
        },
        {
          'rolls': DiceRoll.getRolls([3, 11]),
          'pay': (11/5)
        },
        {
          'rolls': DiceRoll.getRolls(7),
          // Seven pays 5 for 1, minus 5 return, so it is a push.
          'pay': 0
        },
        {
          'rolls': DiceRoll.getRolls([4, 5, 6, 8, 9, 10]),
          'pay': -1
        }
      ];
      var params = {
        'name': 'World',
        'overrideComeOut': true,
        'isCenter': true,
        'resolves': resolves
      };
      super(params);
    }

    /**
     * Establish a point for this bet.
     * @param pointValue [Number] The point to set for this bet.
     * @note This should not establish a point, so it is being overridden to do nothing.
     */
    pointMarked(pointValue) {
      return;
    }
  }

  function exportToGlobal(global) {
    global.Game = Game;
    global.PlayerBet = PlayerBet;
    global.DiceRoll = DiceRoll;
    global.BaseBet = BaseBet;
    global.LineComeBet = LineComeBet;
    global.PassLineBet = PassLineBet;
    global.ComeBet = ComeBet;
    global.DontPassLineBet = DontPassLineBet;
    global.DontComeBet = DontComeBet;
    global.FieldBet = FieldBet;
    global.StingyFieldBet = StingyFieldBet;
    global.BigBet = BigBet;
    global.PlaceBet = PlaceBet;
    global.BuyBet = BuyBet;
    global.LayBet = LayBet;
    global.HardwayBet = HardwayBet;
    global.AcesStraightBet = AcesStraightBet;
    global.AceDeuceStraightBet = AceDeuceStraightBet;
    global.YoStraightBet = YoStraightBet;
    global.TwelveStraightBet = TwelveStraightBet;
    global.HiLoBet = HiLoBet;
    global.HiLoYoBet = HiLoYoBet;
    global.AnyCrapsBet = AnyCrapsBet;
    global.CAndEBet = CAndEBet;
    global.HornBet = HornBet;
    global.HornHighAcesBet = HornHighAcesBet;
    global.HornHighAceDeuceBet = HornHighAceDeuceBet;
    global.HornHighYoBet = HornHighYoBet;
    global.HornHighTwelveBet = HornHighTwelveBet;
    global.AnySevenBet = AnySevenBet;
    global.WorldBet = WorldBet;
  }

  // Export the classes for node.js use.
  if (typeof exports !== 'undefined') {
    exportToGlobal(exports);
  }

  // Add the classes to the window for browser use.
  if (typeof window !== 'undefined') {
    exportToGlobal(window);
  }
})();
