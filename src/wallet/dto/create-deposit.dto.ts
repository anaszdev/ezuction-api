import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateDepositDto {
  @Transform(({ value }) => Number(value)) // ضمان تحويل النص القادم من FormData إلى رقم حقيقي
  @IsNumber({}, { message: 'Charing amount must be real number' })
  @Min(500, { message: 'The minimum number to charge is 500' })
  amount: number;

  @IsString()
  @IsNotEmpty({ message: 'Transaction reciept required' })
  transactionNo: string;

  @IsString()
  @IsNotEmpty({ message: 'Please provide reciept image' })
  receiptImage: string;
}
