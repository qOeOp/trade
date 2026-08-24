//! Lightweight stub implementations useful in unit tests where a full account object is
//! unnecessary.

use rstest::fixture;

use crate::{
    accounts::{Account, AccountAny, BettingAccount, CashAccount, MarginAccount},
    enums::{AccountType, LiquiditySide},
    events::account::{
        state::AccountState,
        stubs::{
            betting_account_state, cash_account_state, cash_account_state_million_usd,
            cash_account_state_million_usdt, cash_account_state_multi, margin_account_state,
        },
    },
    identifiers::stubs::{account_id, uuid4},
    instruments::InstrumentAny,
    types::{AccountBalance, Currency, Money, Price, Quantity},
};

impl Default for CashAccount {
    /// Creates a new default [`CashAccount`] instance.
    fn default() -> Self {
        // million dollar account
        let init_event = AccountState::new(
            account_id(),
            AccountType::Cash,
            vec![AccountBalance::new(
                Money::from("1000000 USD"),
                Money::from("0 USD"),
                Money::from("1000000 USD"),
            )],
            vec![],
            true,
            uuid4(),
            0.into(),
            0.into(),
            Some(Currency::USD()),
        );
        Self::new(init_event, false, false)
    }
}

impl Default for AccountAny {
    /// Creates a new default [`AccountAny`] instance.
    fn default() -> Self {
        Self::Cash(CashAccount::default())
    }
}

#[fixture]
pub fn margin_account(margin_account_state: AccountState) -> MarginAccount {
    MarginAccount::new(margin_account_state, true)
}

#[fixture]
pub fn cash_account(cash_account_state: AccountState) -> CashAccount {
    CashAccount::new(cash_account_state, true, false)
}

#[fixture]
pub fn betting_account(betting_account_state: AccountState) -> BettingAccount {
    BettingAccount::new(betting_account_state, true)
}

#[fixture]
pub fn cash_account_million_usd(cash_account_state_million_usd: AccountState) -> CashAccount {
    CashAccount::new(cash_account_state_million_usd, true, false)
}

#[fixture]
pub fn cash_account_multi(cash_account_state_multi: AccountState) -> CashAccount {
    CashAccount::new(cash_account_state_multi, true, false)
}

#[fixture]
pub fn cash_account_borrowing(cash_account_state: AccountState) -> CashAccount {
    CashAccount::new(cash_account_state, true, true)
}

#[fixture]
pub fn cash_account_borrowing_million_usd(
    cash_account_state_million_usd: AccountState,
) -> CashAccount {
    CashAccount::new(cash_account_state_million_usd, true, true)
}

/// Helper to calculate commission in test fixtures.
///
/// # Panics
///
/// Panics if the underlying `calculate_commission` returns an error.
#[must_use]
pub fn calculate_commission(
    instrument: &InstrumentAny,
    quantity: Quantity,
    price: Price,
    currency: Option<Currency>,
) -> Money {
    let account_state = if Some(Currency::USDT()) == currency {
        cash_account_state_million_usdt()
    } else {
        cash_account_state_million_usd("1000000 USD", "0 USD", "1000000 USD")
    };
    let account = cash_account_million_usd(account_state);
    account
        .calculate_commission(instrument, quantity, price, LiquiditySide::Taker, None)
        .unwrap_or_else(|error| panic!("called `Result::unwrap()` on an `Err` value: {error:?}"))
}
