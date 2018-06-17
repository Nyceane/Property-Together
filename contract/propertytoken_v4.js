/**
 * property token
 * 
 */

'use strict';

var Allowed = function (obj) {
    this.allowed = {};
    this.parse(obj);
}

Allowed.prototype = {
    toString: function () {
        return JSON.stringify(this.allowed);
    },

    parse: function (obj) {
        if (typeof obj != "undefined") {
            var data = JSON.parse(obj);
            for (var key in data) {
                this.allowed[key] = new BigNumber(data[key]);
            }
        }
    },

    get: function (key) {
        return this.allowed[key];
    },

    set: function (key, value) {
        this.allowed[key] = new BigNumber(value);
    }
}

var PropertyToken = function () {
    LocalContractStorage.defineProperties(this, {
        _name: null,
        _symbol: null,
        _decimals: null,
        _totalSupply: {
            parse: function (value) {
                return new BigNumber(value);
            },
            stringify: function (o) {
                return o.toString(10);
            }
        },
        _contractOwner: null,
    });

    LocalContractStorage.defineMapProperties(this, {
        "balances": {
            parse: function (value) {
                return new BigNumber(value);
            },
            stringify: function (o) {
                return o.toString(10);
            }
        },
        "allowed": {
            parse: function (value) {
                return new Allowed(value);
            },
            stringify: function (o) {
                return o.toString();
            }
        }
    });
};

PropertyToken.prototype = {
    init: function (name, symbol, decimals, totalSupply) {
        this._name = name;
        this._symbol = symbol;
        this._decimals = decimals | 0;
        this._totalSupply = new BigNumber(totalSupply).mul(new BigNumber(10).pow(decimals));
        if (this._totalSupply <= 0) {
            throw new Error("total supply cannot be 0 or negative");
        }
        

        var from = Blockchain.transaction.from;
        this.balances.set(from, this._totalSupply);
        this.transferEvent(true, from, from, this._totalSupply);

        this._contractOwner = from;

        let owners = {};
        owners[from] = 1;
        LocalContractStorage.set("owners", owners);
    },

    // Returns the name of the token
    name: function () {
        return this._name;
    },

    // Returns the symbol of the token
    symbol: function () {
        return this._symbol;
    },

    // Returns the number of decimals the token uses
    decimals: function () {
        return this._decimals;
    },

    totalSupply: function () {
        return this._totalSupply.toString(10);
    },

    contractOwner: function() {
      return this._contractOwner;
    },

    owners: function () {
        return LocalContractStorage.get("owners");
    },

    balanceOf: function (owner) {
        var balance = this.balances.get(owner);

        if (balance instanceof BigNumber) {
            return balance.toString(10);
        } else {
            return "0";
        }
    },

    transfer: function (to, value) {
        value = new BigNumber(value);
        if (value.lt(0)) {
            throw new Error("invalid value.");
        }

        var from = Blockchain.transaction.from;
        var balance = this.balances.get(from) || new BigNumber(0);

        if (balance.lt(value)) {
            throw new Error("transfer failed.");
        }

        this.balances.set(from, balance.sub(value));
        var toBalance = this.balances.get(to) || new BigNumber(0);
        this.balances.set(to, toBalance.add(value));

        let owners = LocalContractStorage.get("owners");
        owners[to] = 1;
        LocalContractStorage.set("owners", owners);

        this.transferEvent(true, from, to, value);
    },

    /**
     * if you send x amount of nas to this contract, this contract will send back 1 token. 
     */
    purchase: function () {
        const PRICE = 1000000000000; // amount in nas wei that is required to purchase 1 token_unit.
        const TOKEN_UNIT = 1;
        var buyer = Blockchain.transaction.from;
        var amount = Blockchain.transaction.value;
        amount = new BigNumber(amount);
        if (amount.lt(PRICE)) {
            throw new Error("not enough nas sent.");
        }

        var balance = this.balances.get(this._contractOwner) || new BigNumber(0);

        if (balance.lt(TOKEN_UNIT)) {
            throw new Error("transfer failed. not enough fund");
        }

        this.balances.set(this._contractOwner, balance.sub(TOKEN_UNIT));
        var buyerBalance = this.balances.get(buyer) || new BigNumber(0);
        this.balances.set(buyer, buyerBalance.add(TOKEN_UNIT));

        let owners = LocalContractStorage.get("owners");
        owners[buyer] = 1;
        LocalContractStorage.set("owners", owners);

        this.transferEvent(true, this._contractOwner, buyer, TOKEN_UNIT);
    },

    transferFrom: function (from, to, value) {
        var spender = Blockchain.transaction.from;
        var balance = this.balances.get(from) || new BigNumber(0);

        var allowed = this.allowed.get(from) || new Allowed();
        var allowedValue = allowed.get(spender) || new BigNumber(0);
        value = new BigNumber(value);

        if (value.gte(0) && balance.gte(value) && allowedValue.gte(value)) {

            this.balances.set(from, balance.sub(value));

            // update allowed value
            allowed.set(spender, allowedValue.sub(value));
            this.allowed.set(from, allowed);

            var toBalance = this.balances.get(to) || new BigNumber(0);
            this.balances.set(to, toBalance.add(value));

            this.transferEvent(true, from, to, value);
        } else {
            throw new Error("transfer failed.");
        }
    },

    transferEvent: function (status, from, to, value) {
        Event.Trigger(this.name(), {
            Status: status,
            Transfer: {
                from: from,
                to: to,
                value: value
            }
        });
    },

    approve: function (spender, currentValue, value) {
        var from = Blockchain.transaction.from;

        var oldValue = this.allowance(from, spender);
        if (oldValue != currentValue.toString()) {
            throw new Error("current approve value mistake.");
        }

        var balance = new BigNumber(this.balanceOf(from));
        var value = new BigNumber(value);

        if (value.lt(0) || balance.lt(value)) {
            throw new Error("invalid value.");
        }

        var owned = this.allowed.get(from) || new Allowed();
        owned.set(spender, value);

        this.allowed.set(from, owned);

        this.approveEvent(true, from, spender, value);
    },

    approveEvent: function (status, from, spender, value) {
        Event.Trigger(this.name(), {
            Status: status,
            Approve: {
                owner: from,
                spender: spender,
                value: value
            }
        });
    },

    allowance: function (owner, spender) {
        var owned = this.allowed.get(owner);

        if (owned instanceof Allowed) {
            var spender = owned.get(spender);
            if (typeof spender != "undefined") {
                return spender.toString(10);
            }
        }
        return "0";
    },

    /**
     * distribute rent amount based on the shares.
     * any nas token sent to here will be distributed based on the shares.  
     */
    distributeRent: function () {
        const MINIMUM = new BigNumber(100000000000);

        let amount = Blockchain.transaction.value;
        amount = new BigNumber(amount);

        if (amount.lt(MINIMUM)) {
            throw new Error("not enough nas sent.");
        }

        // totalsupply cannot be 0 because it is checked in init()
        let amountPerUnit = amount.div(this._totalSupply);

        let owners = LocalContractStorage.get("owners");

        for (let payee in owners) {
            if (owners.hasOwnProperty(payee)) {
                let numUnit = this.balances.get(payee) || new BigNumber(0);
                numUnit = new BigNumber(numUnit);
                if (numUnit > 0) {
                    let payoutAmount = numUnit.mul(amountPerUnit);

                    var result = Blockchain.transfer(payee, payoutAmount);
                    if (!result) {
                        Event.Trigger("distributeRent", "transfer failed: " + payoutAmount + " to " + payee);
                        console.log("transfer failed");
                        throw new Error("transfer failed.");
                    } else {
                        Event.Trigger("distributeRent", "transfer result: " + JSON.stringify(result));
                    }
                }
            }
        }
    },
};

module.exports = PropertyToken;
