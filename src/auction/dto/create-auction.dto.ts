import {
  IsString,
  IsNumber,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ClosureType, City, CategoryType } from '@prisma/client'; // 👈 استيراد الـ Enums الرسمية من بريسما

export class CreateAuctionDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsEnum(City, { message: 'يجب اختيار مدينة مدعومة في النظام' }) // 👈 تصحيح: التحقق من الـ Enum تبع المدن
  city: City;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  address?: string;
  @IsEnum(CategoryType, { message: 'يجب اختيار قسم صحيح من الأقسام المعتمدة' }) // 👈 إضافة: حقل القسم المفقود
  category: CategoryType;

  @IsArray()
  @IsString({ each: true })
  images: string[];

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  startingPrice: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  reservePrice: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  bidIncrement?: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  depositRequired: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(1)
  minParticipants: number;

  @IsEnum(ClosureType)
  @IsOptional()
  closureType?: ClosureType;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  bufferTime?: number;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;
}
