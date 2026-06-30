export interface TopUpPackage {
	id: string;
	name: string;
	priceAmount: number; // in cents
	credits: number;
	stripePriceId: string;
	popular?: boolean;
}

export const TOPUP_PACKAGES: TopUpPackage[] = [
	{
		id: 'topup_small',
		name: 'Small Pack',
		priceAmount: 999, // $9.99
		credits: 3000,
		stripePriceId: 'price_1ToBCpCb1Op7pdCaLCWDeHM3',
	},
	{
		id: 'topup_medium',
		name: 'Medium Pack',
		priceAmount: 1999, // $19.99
		credits: 7000,
		stripePriceId: 'price_1ToBCqCb1Op7pdCakwptHMyE',
		popular: true,
	},
	{
		id: 'topup_large',
		name: 'Large Pack',
		priceAmount: 2999, // $29.99
		credits: 12000,
		stripePriceId: 'price_1ToBCrCb1Op7pdCaYsVVo3se',
	},
];
