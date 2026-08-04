import { IsEnum, IsNotEmpty } from 'class-validator';
import { DepositStatus } from '@prisma/client'; // استيراد الـ Enum من بريسما مباشرة

export class UpdateDepositStatusDto {
  @IsEnum(DepositStatus, {
    message: 'APPROVED, REJECTED',
  })
  @IsNotEmpty({ message: 'Provide Process Status' })
  status: DepositStatus;
}
