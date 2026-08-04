// src/auction/dto/auction-filter.dto.ts
import { AuctionStatus, CategoryType, City } from '@prisma/client';
import { IsOptional, IsEnum, IsNumber, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class AuctionFilterDto {
  @IsOptional()
  @IsEnum(AuctionStatus)
  status?: AuctionStatus;

  @IsOptional()
  @IsEnum(CategoryType)
  category?: CategoryType;

  @IsOptional()
  @IsEnum(City)
  city?: City;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  maxPrice?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  limit?: number = 10;
}
