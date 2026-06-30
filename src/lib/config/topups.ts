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
		stripePriceId: 'price_1Qv3x6LkdJ7XyZ8o5n2m4p9q',
	},
	{
		id: 'topup_medium',
		name: 'Medium Pack',
		priceAmount: 1999, // $19.99
		credits: 7000,
		stripePriceId: 'price_1Qv3x7LkdJ7XyZ8o9w1r8t6y',
		popular: true,
	},
	{
		id: 'topup_large',
		name: 'Large Pack',
		priceAmount: 2999, // $29.99
		credits: 12000,
		stripePriceId: 'price_1Qv3x8LkdJ7XyZ8o2k4l6j8h',
	},
];
